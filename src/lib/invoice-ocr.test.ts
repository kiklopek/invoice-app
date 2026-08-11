import { describe, expect, it } from "vitest";
import { LOCAL_OCR_MODEL, normalizeOcrText, parseInvoiceText } from "./invoice-ocr";

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

  it("normalizes Unicode, whitespace and Czech punctuation without losing diacritics", () => {
    expect(normalizeOcrText("  Částka\u00a0–\u00a010 000 Kč  \n\n\n Splatnost ")).toBe("Částka - 10 000 Kč\n\nSplatnost");
  });
});
