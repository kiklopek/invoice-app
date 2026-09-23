import { describe, expect, it } from "vitest";
import type { InvoiceInput } from "@/types/invoice";
import { isOcrHourlyQuotaExceeded, LOCAL_OCR_MODEL, normalizeOcrText, type OcrDocumentLayout, parseInvoiceText, relevantOcrWarnings } from "./invoice-ocr";

const organization = { name: "R. Hlavica s.r.o.", ico: "05829309", dic: "CZ05829309" };

const issuedInvoice = `
FAKTURA – DAŇOVÝ DOKLAD
Dodavatel
R. Hlavica s.r.o.
IČO: 05829309
DIČ: CZ05829309

Odběratel
Stavby Novák s.r.o.
IČO: 12345678
DIČ: CZ12345678
E-mail: FAKTURACE@STAVBYNOVAK.CZ

Číslo faktury: FV-2026-007
Variabilní symbol: 2026007
Datum vystavení: 1. 8. 2026
Datum splatnosti: 15. 8. 2026
Celkem bez DPH 10 000,00 Kč
DPH: 21 %
Celkem k úhradě 12 100,00 Kč
`;

describe("local invoice OCR parser", () => {
  it("extracts Czech invoice fields and selects the customer instead of the issuer", () => {
    const result = parseInvoiceText({ text: issuedInvoice, fileUrl: "org/file.pdf", organization, ocrConfidence: 92 });
    expect(result.invoice).toMatchObject({
      invoice_number: "FV-2026-007",
      counterparty_name: "Stavby Novák s.r.o.",
      counterparty_ico: "12345678",
      counterparty_dic: "CZ12345678",
      counterparty_email: "fakturace@stavbynovak.cz",
      variable_symbol: "2026007",
      amount_without_vat: 10000,
      vat_rate: 21,
      amount: 12100,
      currency: "CZK",
      issue_date: "2026-08-01",
      due_date: "2026-08-15",
      source: "ocr",
      file_url: "org/file.pdf",
    });
    expect(result.issuer_matches_organization).toBe(true);
    expect(result.model).toBe(LOCAL_OCR_MODEL);
    expect(result.response_id).toBeNull();
    expect(result.field_sources.invoice_number).toMatchObject({ page: 1, text: "Číslo faktury: FV-2026-007" });
    expect(result.field_sources.amount).toMatchObject({ page: 1, text: "Celkem k úhradě 12 100,00 Kč" });
  });

  it("disables only the usage quota when the organization limit is null", () => {
    expect(isOcrHourlyQuotaExceeded(null, 100_000)).toBe(false);
    expect(isOcrHourlyQuotaExceeded(20, 19)).toBe(false);
    expect(isOcrHourlyQuotaExceeded(20, 20)).toBe(true);
  });

  it("uses an effective VAT rate when an invoice contains multiple VAT rates", () => {
    const result = parseInvoiceText({
      text: `${issuedInvoice.replace("DPH: 21 %", "DPH 12 %\nDPH 21 %").replace("10 000,00", "1 000,00").replace("12 100,00", "1 180,00")}`,
      fileUrl: "org/mixed.pdf",
      organization,
    });
    expect(result.invoice.amount_without_vat).toBe(1000);
    expect(result.invoice.amount).toBe(1180);
    expect(result.invoice.vat_rate).toBe(18);
    expect(result.warnings.join(" ")).toContain("více sazeb DPH");
  });

  it("supports invoices without VAT", () => {
    const result = parseInvoiceText({
      text: issuedInvoice.replace("DPH: 21 %", "Dodavatel není plátce DPH").replace("12 100,00", "10 000,00"),
      fileUrl: "org/no-vat.pdf",
      organization,
    });
    expect(result.invoice).toMatchObject({ amount_without_vat: 10000, vat_rate: 0, amount: 10000 });
  });

  it("parses a Czech invoice title, unaccented payment label and focused customer block", () => {
    const result = parseInvoiceText({
      text: `
FAKTURA - DAŇOVÝ DOKLAD č. 2600253
Variabilní symbol: 2600253
Datum vystavení: 12.03.2026
Datum splatnosti: 26.03.2026
Součet položek 2 654 722,60 547 591,75 3 202 314,35
CELKEM K UHRADE Kč 3 202 315,00
ODBĚRATEL DETAIL
Odběratel: IČO: 87654321
DIČ: CZ87654321
Odběratel a.s.
Jozef Příjemce
Ulice 22
543 21 Obec
mail: odberatel@email.com
`,
      fileUrl: "org/mobile.png",
      organization: { name: "Firma s.r.o.", ico: "12345678", dic: "CZ12345678" },
      ocrConfidence: 80,
    });

    expect(result.invoice).toMatchObject({
      invoice_number: "2600253",
      counterparty_name: "Odběratel a.s.",
      counterparty_ico: "87654321",
      counterparty_dic: "CZ87654321",
      counterparty_email: "odberatel@email.com",
      variable_symbol: "2600253",
      amount_without_vat: 2654722.6,
      amount: 3202315,
      currency: "CZK",
      issue_date: "2026-03-12",
      due_date: "2026-03-26",
    });
  });

  it("extracts the primary R. Hlavica invoice layout with changing values", () => {
    const result = parseInvoiceText({
      text: `
R. HLAVICA s.r.o. DIČ : CZ26296039
Palackého třída 192/60 IČ : 26296039
Daňový doklad F A K T U R A
Číslo faktury : 2600178 Odběratel : MADREV s.r.o.
HLÍNA 18
664 91 IVANČICE
CZ - Česká republika
DIČ : CZ46992782
IČ : 46992782
Datum vystavení : 06.08.2026
Forma úhrady : Převodním příkazem
Datum splatnosti: 20.08.2026
Datum UZP : 28.07.2026
Text Množství DPH Cena Celkem
Fakturujeme Vám dopravu:
- doprava 28.7.2026, WR 1897 36,260 m3 21 % 240,00 8 702,40
Sazba DPH : Není předmětem Reverse Charge - Snížená Základní (21%) Celkem
Daň : 0,00 1 827,50 1 827,50
Základ daně : 0,00 0,00 0,00 8 702,40 8 702,40
Celkem : 0,00 0,00 0,00 10 529,90 10 529,90
K úhradě : 10 529,90 Kč
Email : kostihova@hlavica.cz, web : www.hlavica.cz
`,
      fileUrl: "org/faktura-2600178.pdf",
      organization: { name: "R. HLAVICA s.r.o.", ico: "26296039", dic: "CZ26296039" },
    });

    expect(result.invoice).toMatchObject({
      invoice_number: "2600178",
      counterparty_name: "MADREV s.r.o.",
      counterparty_ico: "46992782",
      counterparty_dic: "CZ46992782",
      counterparty_email: "",
      variable_symbol: "",
      amount_without_vat: 8702.4,
      vat_rate: 21,
      amount: 10529.9,
      currency: "CZK",
      issue_date: "2026-08-06",
      due_date: "2026-08-20",
    });
    expect(result.document_kind).toBe("issued_invoice");
    expect(result.issuer_matches_organization).toBe(true);
  });

  it("does not invent missing fields and reports them for manual review", () => {
    const result = parseInvoiceText({ text: "Nečitelný dokument\nCelkem k úhradě 500 EUR", fileUrl: "org/photo.jpg", organization });
    expect(result.invoice.invoice_number).toBe("");
    expect(result.invoice.counterparty_name).toBe("");
    expect(result.invoice.currency).toBe("EUR");
    expect(result.warnings.join(" ")).toContain("Číslo faktury nebylo rozpoznáno");
    expect(result.warnings.join(" ")).toContain("E-mail odběratele nebyl rozpoznán");
  });

  it("skips a non-numeric label neighbor (e.g. a merged column header) and finds the real invoice number", () => {
    // Layouts other than this app's own template can collapse a two-column
    // header row ("Číslo faktury" on the left, a "Dodavatel"/"Odběratel"
    // column heading on the right) onto one reconstructed text line. The
    // actual number then only appears on the next line.
    const result = parseInvoiceText({
      text: `
FAKTURA
Číslo faktury Dodavatel
FV2026099
Odběratel: Soukromá osoba s.r.o.
E-mail: info@soukroma.cz
Datum vystavení: 2. 9. 2026
Datum splatnosti: 16. 9. 2026
Celkem k úhradě 15 660,00 Kč
`,
      fileUrl: "org/other-template.pdf",
      organization,
    });
    expect(result.invoice.invoice_number).toBe("FV2026099");
    expect(result.invoice.invoice_number).not.toBe("Dodavatel");
  });

  it("discards an implausible net amount instead of silently pairing it with the wrong VAT rate", () => {
    // On an unfamiliar layout, "Základ daně" can end up matched to an
    // unrelated small number (e.g. a quantity column) rather than the real
    // subtotal. Pairing that with the correct gross total would imply an
    // absurd VAT rate (over 100 000%) -- the parser should recognize that as
    // implausible and fall back to the gross amount instead of an invented
    // near-zero net total.
    const result = parseInvoiceText({
      text: `
FAKTURA
Číslo faktury: FV2026100
Odběratel: Soukromá osoba
E-mail: info@soukroma.cz
Datum vystavení: 2. 9. 2026
Datum splatnosti: 16. 9. 2026
Základ daně 6 ks
Celkem k úhradě 15 660,00 Kč
`,
      fileUrl: "org/other-template-2.pdf",
      organization,
    });
    expect(result.invoice.amount).toBe(15660);
    expect(result.invoice.amount_without_vat).toBe(15660);
    expect(result.invoice.vat_rate).toBe(0);
    expect(result.warnings.join(" ")).toContain("Základ bez DPH nebyl spolehlivě rozpoznán");
  });

  it("doesn't mistake a rate baked into a column heading for the net amount", () => {
    // Real bug: "Základ DPH 21 % Celkem" as a one-row item table's heading
    // contains a digit ("21"), so the table-heading detector (which bails
    // out on any digit, to avoid treating a genuine "label: amount" line as
    // a heading) didn't recognize it as a heading at all. The "zaklad dph"
    // label then matched THIS row, found no amount on it, fell through to
    // "21 %" -- and took the lone "21" as if it were the net amount, paired
    // it with the real gross (12 100) and got a ~57 000 % implied VAT rate.
    // The fix strips "N %" before the digit check, since a rate baked into a
    // heading is not evidence of a real label:amount line.
    const result = parseInvoiceText({
      text: `
FAKTURA
Číslo faktury / VS: 20260001
Odběratel: Test Zákazník s.r.o.
IČO: 12345678
E-mail: info@test.cz
Datum vystavení: 2. 9. 2026
Datum splatnosti: 20. 9. 2026
Položka Základ DPH 21 % Celkem
Testovací předplatné - září 2026 10 000,00 Kč 2 100,00 Kč 12 100,00 Kč
K úhradě: 12 100,00 Kč
`,
      fileUrl: "org/rate-in-heading.pdf",
      organization,
    });
    expect(result.invoice.amount).toBe(12100);
    expect(result.invoice.amount_without_vat).toBe(10000);
    expect(result.invoice.vat_rate).toBe(21);
  });

  it("never takes the total from an item-table column heading, nor a digit fragment of a year in prose", () => {
    // Exactly the real layout that produced a 6 CZK invoice: "Celkem s DPH"
    // is a COLUMN HEADING here, the line under it is a sentence, and the
    // amount pattern used to chop "2026" into "202" + "6" -- so the last
    // "amount" on that line was a stray 6 that outranked "K úhradě".
    const result = parseInvoiceText({
      text: `
FAKTURA
Číslo faktury: 260610
Odběratel: C.S.CARGO a.s.
E-mail: fakturace@cscargo.cz
Datum vystavení: 2. 9. 2026
Datum splatnosti: 16. 9. 2026
Text Množství DPH Cena Celkem bez DPH Celkem s DPH*
Fakturuji Vám tímto na základě smlouvy o nájmu nebytových prostor nájem a ostrahu v měsíci září 2026:
Základ daně: 12 942,00
DPH: 21 %
K úhradě : 15 660,00 Kč
`,
      fileUrl: "org/column-heading.pdf",
      organization,
    });
    expect(result.invoice.amount).toBe(15660);
    expect(result.invoice.amount_without_vat).toBe(12942);
    expect(result.invoice.vat_rate).toBe(21);
  });

  it("never adopts the supplier's own e-mail as the customer's when the document has no customer block", () => {
    // The e-mail was the one counterparty field with no supplier guard: with no
    // recognizable customer heading it fell back to the first address ANYWHERE,
    // which on a supplier-first layout is ours. That address then rode the
    // invoice trigger into the customer registry and showed up as a duplicate
    // "customer" that was really us. Finding nothing is the correct answer --
    // the caller already warns that the e-mail has to be filled in by hand.
    const result = parseInvoiceText({
      text: `
FAKTURA
Dodavatel
R. Hlavica s.r.o.
IČO: 05829309
DIČ: CZ05829309
E-mail: adam@hlavica.cz
Číslo faktury: 260700
Datum vystavení: 2. 9. 2026
Datum splatnosti: 16. 9. 2026
K úhradě: 9 680,00 Kč
`,
      fileUrl: "org/no-customer-block.pdf",
      organization,
    });
    expect(result.invoice.counterparty_email).toBe("");
  });

  it("reads a whole number as one amount instead of splitting it into fragments", () => {
    const result = parseInvoiceText({
      text: `
FAKTURA
Číslo faktury: 2026001
Odběratel: Firma s.r.o.
E-mail: firma@example.cz
IČO: 66151023
Datum vystavení: 2. 9. 2026
Datum splatnosti: 16. 9. 2026
Celkem bez DPH 10 000,00 Kč
DPH: 21 %
Celkem k úhradě 12 100,00 Kč
`,
      fileUrl: "org/whole-numbers.pdf",
      organization,
    });
    expect(result.invoice.amount).toBe(12100);
    expect(result.invoice.amount_without_vat).toBe(10000);
  });

  it("prefers a VAT-plausible net amount when a merged multi-column tax breakdown line has several numbers", () => {
    // Same root cause as the two-column Dodavatel/Odběratel mix-up elsewhere
    // in this file, just applied to a numeric table instead of a
    // counterparty section: a multi-rate VAT breakdown row (Není předmětem
    // DPH | Osvobozeno 0% | Snížená | Základní 21%) that gets merged onto one
    // text line leaves several numbers on the "Celkem bez DPH" line. Blindly
    // trusting a fixed position would pick the tiny 0,18 Kč rounding
    // remainder instead of the real 10 000,00 Kč base.
    const result = parseInvoiceText({
      text: issuedInvoice.replace("Celkem bez DPH 10 000,00 Kč", "Celkem bez DPH 0,18 0,00 0,00 10 000,00 Kč"),
      fileUrl: "org/merged-vat-table.pdf",
      organization,
    });
    expect(result.invoice.amount_without_vat).toBe(10000);
    expect(result.invoice.vat_rate).toBe(21);
    expect(result.invoice.amount).toBe(12100);
    expect(result.warnings.join(" ")).not.toContain("Základ bez DPH nebyl spolehlivě rozpoznán");
  });

  it("reconstructs a merged VAT recap table from real column geometry instead of guessing a position (dominant 21% column)", () => {
    // Coordinates below are the *actual* geometry pdfjs produced for the real
    // "260610" (C.S.CARGO) sample invoice PDF -- captured by running the real
    // extraction pipeline (extractInvoiceDocumentText -> layoutPdfPage)
    // against the file directly, not invented. They prove right-edge
    // matching is needed: a numeric cell's left edge drifts under a wide
    // header like "Není předmětem", but its right edge (x + width) lines up
    // almost exactly with its own column header's right edge in both real
    // sample invoices.
    const layout: OcrDocumentLayout = {
      pages: [{
        page: 1, width: 1000, height: 1000,
        lines: [
          {
            page: 1, line: 1, source: "pdf_text", confidence: null, bounds: null,
            text: "Sazba DPH: Není předmětem Osvobozeno (0% ) Snížená Základní (21%) Celkem",
            blocks: [
              { text: "Sazba DPH:", confidence: null, x: 0.074, y: 0.494, width: 0.071, height: 0.01 },
              { text: "Není předmětem", confidence: null, x: 0.222, y: 0.494, width: 0.096, height: 0.01 },
              { text: "Osvobozeno (0% )", confidence: null, x: 0.336, y: 0.494, width: 0.105, height: 0.01 },
              { text: "Snížená", confidence: null, x: 0.649, y: 0.494, width: 0.045, height: 0.01 },
              { text: "Základní (21%)", confidence: null, x: 0.729, y: 0.494, width: 0.091, height: 0.01 },
              { text: "Celkem", confidence: null, x: 0.907, y: 0.494, width: 0.044, height: 0.01 },
            ],
          },
          {
            // A stray wrapped-header fragment ("DPH", the second line of a
            // two-line "Není předmětem / DPH" header) lands on this row due
            // to the same Y-clustering imprecision -- it must be ignored
            // rather than misread as a value, which happens for free since
            // it isn't a parseable amount.
            page: 1, line: 2, source: "pdf_text", confidence: null, bounds: null,
            text: "Daň: DPH 0,00 2 717,82 2 717,82",
            blocks: [
              { text: "Daň:", confidence: null, x: 0.074, y: 0.504, width: 0.028, height: 0.01 },
              { text: "DPH", confidence: null, x: 0.289, y: 0.504, width: 0.028, height: 0.01 },
              { text: "0,00", confidence: null, x: 0.67, y: 0.504, width: 0.024, height: 0.01 },
              { text: "2 717,82", confidence: null, x: 0.773, y: 0.504, width: 0.047, height: 0.01 },
              { text: "2 717,82", confidence: null, x: 0.904, y: 0.504, width: 0.047, height: 0.01 },
            ],
          },
          {
            page: 1, line: 3, source: "pdf_text", confidence: null, bounds: null,
            text: "Základ daně: 0,18 0,00 0,00 12 942,00 12 942,18",
            blocks: [
              { text: "Základ daně:", confidence: null, x: 0.074, y: 0.519, width: 0.077, height: 0.01 },
              { text: "0,18", confidence: null, x: 0.294, y: 0.519, width: 0.024, height: 0.01 },
              { text: "0,00", confidence: null, x: 0.417, y: 0.519, width: 0.024, height: 0.01 },
              { text: "0,00", confidence: null, x: 0.67, y: 0.519, width: 0.024, height: 0.01 },
              { text: "12 942,00", confidence: null, x: 0.766, y: 0.519, width: 0.054, height: 0.01 },
              { text: "12 942,18", confidence: null, x: 0.897, y: 0.519, width: 0.054, height: 0.01 },
            ],
          },
        ],
      }],
    };
    const result = parseInvoiceText({
      text: issuedInvoice.replace("Celkem bez DPH 10 000,00 Kč\nDPH: 21 %\nCelkem k úhradě 12 100,00 Kč", "K úhradě : 15 660,00"),
      fileUrl: "org/vat-table-geometry-260610.pdf",
      organization,
      layout,
    });
    // The document's own base total: 12 942,00 taxed at 21 % plus the 0,18
    // sitting in "Není předmětem DPH" = 12 942,18, which is what the invoice
    // prints in its "Celkem" column and what adds up with the 2 717,82 tax to
    // the stated 15 660,00. Taking the 21 % column alone would quietly drop
    // those haléře; 0,18 alone would be the rounding column by itself.
    expect(result.invoice.amount_without_vat).toBe(12942.18);
    expect(result.invoice.vat_rate).toBe(21);
    expect(result.warnings.join(" ")).not.toContain("Základ bez DPH nebyl spolehlivě rozpoznán");
  });

  it("reconstructs a merged VAT recap table where the real amount sits in the exempt (Osvobozeno 0%) column, not Základní", () => {
    // Same real geometry pattern, this time from the real "260627" (Tetiana
    // Bahyrian) sample invoice, which is fully exempt: the whole amount sits
    // in the "Osvobozeno (0%)" column and "Základní (21%)" is genuinely 0 --
    // confirms the table reconstruction doesn't just default to whichever
    // column states a non-zero percentage.
    const layout: OcrDocumentLayout = {
      pages: [{
        page: 1, width: 1000, height: 1000,
        lines: [
          {
            page: 1, line: 1, source: "pdf_text", confidence: null, bounds: null,
            text: "Sazba DPH: Není předmětem Osvobozeno (0% ) Snížená Základní (21%) Celkem",
            blocks: [
              { text: "Sazba DPH:", confidence: null, x: 0.074, y: 0.477, width: 0.071, height: 0.01 },
              { text: "Není předmětem", confidence: null, x: 0.222, y: 0.477, width: 0.096, height: 0.01 },
              { text: "Osvobozeno (0% )", confidence: null, x: 0.336, y: 0.477, width: 0.105, height: 0.01 },
              { text: "Snížená", confidence: null, x: 0.649, y: 0.477, width: 0.045, height: 0.01 },
              { text: "Základní (21%)", confidence: null, x: 0.729, y: 0.477, width: 0.091, height: 0.01 },
              { text: "Celkem", confidence: null, x: 0.907, y: 0.477, width: 0.044, height: 0.01 },
            ],
          },
          {
            page: 1, line: 2, source: "pdf_text", confidence: null, bounds: null,
            text: "Daň: DPH 0,00 0,00 0,00",
            blocks: [
              { text: "Daň:", confidence: null, x: 0.074, y: 0.488, width: 0.028, height: 0.01 },
              { text: "DPH", confidence: null, x: 0.289, y: 0.488, width: 0.028, height: 0.01 },
              { text: "0,00", confidence: null, x: 0.67, y: 0.488, width: 0.024, height: 0.01 },
              { text: "0,00", confidence: null, x: 0.796, y: 0.488, width: 0.024, height: 0.01 },
              { text: "0,00", confidence: null, x: 0.928, y: 0.488, width: 0.024, height: 0.01 },
            ],
          },
          {
            page: 1, line: 3, source: "pdf_text", confidence: null, bounds: null,
            text: "Základ daně: 0,00 3 750,00 0,00 0,00 3 750,00",
            blocks: [
              { text: "Základ daně:", confidence: null, x: 0.074, y: 0.503, width: 0.077, height: 0.01 },
              { text: "0,00", confidence: null, x: 0.294, y: 0.503, width: 0.024, height: 0.01 },
              { text: "3 750,00", confidence: null, x: 0.394, y: 0.503, width: 0.047, height: 0.01 },
              { text: "0,00", confidence: null, x: 0.67, y: 0.503, width: 0.024, height: 0.01 },
              { text: "0,00", confidence: null, x: 0.796, y: 0.503, width: 0.024, height: 0.01 },
              { text: "3 750,00", confidence: null, x: 0.904, y: 0.503, width: 0.047, height: 0.01 },
            ],
          },
        ],
      }],
    };
    const result = parseInvoiceText({
      text: issuedInvoice.replace("Celkem bez DPH 10 000,00 Kč\nDPH: 21 %\nCelkem k úhradě 12 100,00 Kč", "K úhradě : 3 750,00"),
      fileUrl: "org/vat-table-geometry-260627.pdf",
      organization,
      layout,
    });
    expect(result.invoice.amount_without_vat).toBe(3750);
    expect(result.invoice.vat_rate).toBe(0);
    expect(result.invoice.amount).toBe(3750);
    expect(result.warnings.join(" ")).not.toContain("Základ bez DPH nebyl spolehlivě rozpoznán");
  });

  it("normalizes Unicode, whitespace and Czech punctuation without losing diacritics", () => {
    expect(normalizeOcrText("  Částka\u00a0–\u00a010 000 Kč  \n\n\n Splatnost ")).toBe("Částka - 10 000 Kč\n\nSplatnost");
  });

  describe("robustness across unfamiliar invoice layouts", () => {
    it("reads a fully unaccented Czech invoice (diacritics stripped by the source system, not OCR)", () => {
      const result = parseInvoiceText({
        text: `
FAKTURA - DANOVY DOKLAD
Cislo faktury: FV2026500
Variabilni symbol: 2026500
Datum vystaveni: 03.09.2026
Datum splatnosti: 17.09.2026
Odberatel: Bezdiakritika s.r.o.
ICO: 11223344
DIC: CZ11223344
E-mail: info@bezdiakritika.cz
Zaklad dane 5 000,00 Kc
DPH 21 %
Celkem k uhrade 6 050,00 Kc
`,
        fileUrl: "org/unaccented.pdf",
        organization,
      });
      expect(result.invoice).toMatchObject({
        invoice_number: "FV2026500",
        counterparty_name: "Bezdiakritika s.r.o.",
        counterparty_ico: "11223344",
        counterparty_dic: "CZ11223344",
        counterparty_email: "info@bezdiakritika.cz",
        variable_symbol: "2026500",
        amount_without_vat: 5000,
        vat_rate: 21,
        amount: 6050,
        currency: "CZK",
        issue_date: "2026-09-03",
        due_date: "2026-09-17",
      });
    });

    it("reads an English-labeled invoice with a differently ordered layout", () => {
      const result = parseInvoiceText({
        text: `
TAX INVOICE
Invoice number: INV-2026-042
Issue date: 2026-09-01
Due date: 2026-09-15
Bill to: Global Buyer Ltd.
ICO: 99887766
VAT: CZ99887766
Email: accounts@globalbuyer.com
Subtotal 2 000,00 EUR
VAT 21 %
Total due 2 420,00 EUR
`,
        fileUrl: "org/english.pdf",
        organization,
      });
      expect(result.invoice).toMatchObject({
        invoice_number: "INV-2026-042",
        counterparty_name: "Global Buyer Ltd.",
        counterparty_ico: "99887766",
        counterparty_dic: "CZ99887766",
        counterparty_email: "accounts@globalbuyer.com",
        amount_without_vat: 2000,
        vat_rate: 21,
        amount: 2420,
        currency: "EUR",
        issue_date: "2026-09-01",
        due_date: "2026-09-15",
      });
    });

    it("reads alternate Czech wording for dates, amounts and the customer heading", () => {
      const result = parseInvoiceText({
        text: `
DAŇOVÝ DOKLAD č. 700321
Objednatel: Alternativní zákazník a.s.
IČO: 55667788
DIČ: CZ55667788
E-mail: fakturace@alt-zakaznik.cz
Vystaveno dne: 10.9.2026
Uhraďte do: 24.9.2026
Cena bez DPH 8 000,00 Kč
DPH 21 %
Celkem k platbě 9 680,00 Kč
`,
        fileUrl: "org/alt-wording.pdf",
        organization,
      });
      expect(result.invoice).toMatchObject({
        invoice_number: "700321",
        counterparty_name: "Alternativní zákazník a.s.",
        counterparty_ico: "55667788",
        counterparty_dic: "CZ55667788",
        counterparty_email: "fakturace@alt-zakaznik.cz",
        amount_without_vat: 8000,
        vat_rate: 21,
        amount: 9680,
        issue_date: "2026-09-10",
        due_date: "2026-09-24",
      });
    });

    it("does not corrupt the Kč currency symbol when amount labels are diacritic-stripped for matching", () => {
      const result = parseInvoiceText({
        text: `
FAKTURA
Číslo faktury: FV2026600
Odběratel: Test Zákazník s.r.o.
E-mail: test@zakaznik.cz
Datum vystavení: 1. 9. 2026
Datum splatnosti: 15. 9. 2026
Základ daně 1 000,00 Kč
Celkem k úhradě 1 210,00 Kč
`,
        fileUrl: "org/kc-currency.pdf",
        organization,
      });
      expect(result.invoice.currency).toBe("CZK");
      expect(result.invoice.amount_without_vat).toBe(1000);
      expect(result.invoice.amount).toBe(1210);
    });

    it("resolves the counterparty correctly when the invoice issuer is a different legal identity of the same business (FO) than the one configured in Settings", () => {
      // R. Hlavica issues invoices under more than one real legal identity --
      // a sole trader (FO) for some, one or more s.r.o. companies for others.
      // Settings only has one configured `organization` (the s.r.o.), so an
      // invoice actually issued by the FO identity must still be parsed
      // correctly: the FO's own IČO/name must not leak into the counterparty
      // fields just because it doesn't match the configured organization.
      const result = parseInvoiceText({
        text: `
FAKTURA
Dodavatel
Robert Hlavica
IČO: 74185296
Odběratel
Cargo a.s.
IČO: 12312312
DIČ: CZ12312312
E-mail: fakturace@cargo.cz
Číslo faktury: 2026321
Datum vystavení: 3. 9. 2026
Datum splatnosti: 17. 9. 2026
Celkem k úhradě 5 000,00 Kč
`,
        fileUrl: "org/fo-issuer.pdf",
        organization,
      });
      expect(result.invoice.counterparty_name).toBe("Cargo a.s.");
      expect(result.invoice.counterparty_ico).toBe("12312312");
      expect(result.invoice.counterparty_dic).toBe("CZ12312312");
      expect(result.invoice.counterparty_email).toBe("fakturace@cargo.cz");
      expect(result.issuer_matches_organization).toBe(false);
      // Still flagged for a quick human double-check, but no longer implies
      // the document is necessarily wrong -- this business legitimately
      // issues under more than one identity.
      expect(result.warnings.join(" ")).toContain("může to být v pořádku");
      expect(result.warnings.join(" ")).not.toContain("neodpovídá nastavené firmě.");
    });

    it("does not swap the issuer's own IČO/DIČ into the counterparty when a two-column layout merges both columns onto shared text lines", () => {
      // Real-world PDF bug: `layoutPdfPage` reconstructs reading order by
      // grouping PDF text items into rows purely by Y position. When the
      // Dodavatel (left) and Odběratel (right) boxes drift out of vertical
      // sync -- a longer name, an extra registry line -- a row ends up
      // pairing the ISSUER's own IČ/DIČ with the COUNTERPARTY's address on
      // one merged text line, e.g. "IČ: 66151023 Hradecká 1116". Because the
      // issuer's real IČ/DIČ then sit past where the "Odběratel" heading
      // already closed the issuer-section scan, plain text/line heuristics
      // can't exclude them -- only the underlying x-position (still tracked
      // per token in `layout`, independent of which merged line it landed
      // on) can tell the two columns apart.
      const text = `
Dodavatel:
Odběratel: C.S.CARGO a.s.
DIČ: CZ7311145842
IČ: 66151023 Hradecká 1116
50601 Jičín
DIČ: CZ64259374
IČ: 64259374
Robert Hlavica
Číslo faktury: 260610
Datum vystavení: 2. 9. 2026
Datum splatnosti: 16. 9. 2026
Celkem k úhradě 15 660,00 Kč
`;
      const layout: OcrDocumentLayout = {
        pages: [{
          page: 1,
          width: 1000,
          height: 1000,
          lines: [
            { page: 1, line: 1, text: "Dodavatel:", source: "pdf_text", confidence: null, bounds: null, blocks: [{ text: "Dodavatel:", confidence: null, x: 0.08, y: 0.9, width: 0.1, height: 0.02 }] },
            { page: 1, line: 2, text: "Odběratel: C.S.CARGO a.s.", source: "pdf_text", confidence: null, bounds: null, blocks: [{ text: "Odběratel: C.S.CARGO a.s.", confidence: null, x: 0.55, y: 0.88, width: 0.3, height: 0.02 }] },
            { page: 1, line: 3, text: "DIČ: CZ7311145842", source: "pdf_text", confidence: null, bounds: null, blocks: [{ text: "DIČ: CZ7311145842", confidence: null, x: 0.08, y: 0.8, width: 0.2, height: 0.02 }] },
            {
              page: 1, line: 4, text: "IČ: 66151023 Hradecká 1116", source: "pdf_text", confidence: null, bounds: null,
              blocks: [
                { text: "IČ: 66151023", confidence: null, x: 0.08, y: 0.78, width: 0.15, height: 0.02 },
                { text: "Hradecká 1116", confidence: null, x: 0.6, y: 0.78, width: 0.2, height: 0.02 },
              ],
            },
            { page: 1, line: 5, text: "50601 Jičín", source: "pdf_text", confidence: null, bounds: null, blocks: [{ text: "50601 Jičín", confidence: null, x: 0.6, y: 0.76, width: 0.15, height: 0.02 }] },
            { page: 1, line: 6, text: "DIČ: CZ64259374", source: "pdf_text", confidence: null, bounds: null, blocks: [{ text: "DIČ: CZ64259374", confidence: null, x: 0.6, y: 0.74, width: 0.2, height: 0.02 }] },
            { page: 1, line: 7, text: "IČ: 64259374", source: "pdf_text", confidence: null, bounds: null, blocks: [{ text: "IČ: 64259374", confidence: null, x: 0.6, y: 0.72, width: 0.15, height: 0.02 }] },
            { page: 1, line: 8, text: "Robert Hlavica", source: "pdf_text", confidence: null, bounds: null, blocks: [{ text: "Robert Hlavica", confidence: null, x: 0.08, y: 0.7, width: 0.15, height: 0.02 }] },
          ],
        }],
      };

      const result = parseInvoiceText({ text, fileUrl: "org/two-column.pdf", organization, layout });
      expect(result.invoice.counterparty_name).toBe("C.S.CARGO a.s.");
      expect(result.invoice.counterparty_ico).toBe("64259374");
      expect(result.invoice.counterparty_dic).toBe("CZ64259374");
    });

    it("warns and lowers confidence when the counterparty IČO can't be recognized", () => {
      // Unlike name/e-mail/amount/dates, a missing IČO used to pass through
      // completely silently -- no warning, and it didn't affect the reported
      // confidence either, so a wrong or absent IČO could hide behind a
      // seemingly high score.
      const withIco = parseInvoiceText({ text: issuedInvoice, fileUrl: "org/with-ico.pdf", organization, ocrConfidence: 92 });
      const withoutIco = parseInvoiceText({
        text: issuedInvoice.replace("IČO: 12345678\n", ""),
        fileUrl: "org/missing-ico.pdf",
        organization,
        ocrConfidence: 92,
      });
      expect(withoutIco.invoice.counterparty_ico).toBe("");
      expect(withoutIco.warnings).toContain("IČO odběratele nebylo rozpoznáno.");
      expect(withoutIco.confidence).toBeLessThan(withIco.confidence);
    });

    it("does not warn about a missing DIČ -- plenty of legitimate counterparties (non-VAT-payers, individuals) have none", () => {
      const result = parseInvoiceText({
        text: issuedInvoice.replace("DIČ: CZ12345678\n", ""),
        fileUrl: "org/no-dic.pdf",
        organization,
      });
      expect(result.invoice.counterparty_dic).toBe("");
      expect(result.invoice.counterparty_ico).toBe("12345678");
      expect(result.warnings.join(" ")).not.toMatch(/DIČ/);
    });

    it("preserves the original invoice number's case and accented company name despite diacritic-insensitive label matching", () => {
      const result = parseInvoiceText({
        text: `
FAKTURA
Cislo dokladu: aB-2026/Rr
Odberatel:Ářčšěžý s.r.o.
E-mail: info@arcsezy.cz
Datum vystaveni: 5. 9. 2026
Datum splatnosti: 19. 9. 2026
Celkem k uhrade 1 000,00 Kc
`,
        fileUrl: "org/case-preserving.pdf",
        organization,
      });
      expect(result.invoice.invoice_number).toBe("aB-2026/Rr");
      expect(result.invoice.counterparty_name).toBe("Ářčšěžý s.r.o.");
    });
  });
});

describe("relevantOcrWarnings", () => {
  const blankInvoice: InvoiceInput = {
    invoice_number: "", counterparty_name: "", counterparty_email: "",
    amount_without_vat: 0, vat_rate: 0, amount: 0, currency: "CZK", issue_date: "", due_date: "",
  };

  it("drops a 'field not recognized' warning once the accountant has filled that field in by hand", () => {
    const warnings = ["Číslo faktury nebylo rozpoznáno.", "IČO odběratele nebylo rozpoznáno."];
    const filledIn: InvoiceInput = { ...blankInvoice, invoice_number: "FV-2026-100", counterparty_ico: "12345678" };
    expect(relevantOcrWarnings(warnings, filledIn)).toEqual([]);
  });

  it("keeps a 'field not recognized' warning while that field is still empty", () => {
    const warnings = ["Číslo faktury nebylo rozpoznáno."];
    expect(relevantOcrWarnings(warnings, blankInvoice)).toEqual(warnings);
  });

  it("never drops warnings that aren't about a specific missing field, regardless of form state", () => {
    const warnings = ["Faktura obsahuje více sazeb DPH. Předvyplněna je efektivní sazba z celkových částek."];
    const filledIn: InvoiceInput = { ...blankInvoice, invoice_number: "FV-2026-100" };
    expect(relevantOcrWarnings(warnings, filledIn)).toEqual(warnings);
  });
});

describe("dlouhé nepřerušované řady číslic v hlavičce dokumentu", () => {
  // Skutečný incident (23. 9., reálná faktura dvou tras): dokument v hlavičce
  // nese IBAN bez mezer ("CZ3601000000006844160247"). AMOUNT_SOURCE regex
  // nemá horní mez na délku neseskupené číslice, takže tuhle 22místnou řadu
  // vezme jako jedinou "částku". Number(...) na ní ztratí přesnost a přejde
  // do exponenciálního zápisu; minorUnits() na tom pak spočítá hodnotu daleko
  // za Number.MAX_SAFE_INTEGER a vyhodí "Částka je mimo podporovaný rozsah."
  // -- bez zachycení, takže spadne celé parseInvoiceText a OCR faktury s
  // IBANem v hlavičce (běžný případ) selže vždy, bez ohledu na to, co je
  // v tabulce položek. Řádek s vlastním IBANem prochází stejnou cestou jako
  // řádek protistrany, protože bestSource() prohledává KAŽDÝ řádek dokumentu.
  const withIban = `
FAKTURA
R. Hlavica s.r.o.
IBAN : CZ3601000000006844160247
Odběratel : Marland s.r.o.
IČO : 05369495
DIČ : CZ05369495

Číslo faktury : 2600194
Datum vystavení : 08.09.2026
Datum splatnosti: 22.09.2026
K úhradě : 85 585,20 Kč
`;

  it("nespadne na dlouhém IBANu v hlavičce, jen ho ignoruje jako částku", () => {
    expect(() => parseInvoiceText({ text: withIban, fileUrl: "org/file.pdf", organization })).not.toThrow();
  });

  it("i s IBANem v dokumentu správně najde celkovou částku a protistranu", () => {
    const result = parseInvoiceText({ text: withIban, fileUrl: "org/file.pdf", organization });
    expect(result.invoice.amount).toBe(85585.2);
    expect(result.invoice.counterparty_name).toBe("Marland s.r.o.");
  });
});
