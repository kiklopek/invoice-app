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
