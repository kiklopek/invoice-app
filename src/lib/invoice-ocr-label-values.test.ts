import { describe, expect, it } from "vitest";
import { parseInvoiceText } from "./invoice-ocr";

const organization = { name: "Vystavitel s.r.o.", ico: "05829309", dic: "CZ05829309" };
const parse = (details: string) => parseInvoiceText({
  text: `FAKTURA
Dodavatel
Vystavitel s.r.o.
Company registration number:
05829309
Tax identification number:
CZ05829309
Odběratel
Zákazník s.r.o.
${details}
Číslo faktury: FV-2026-001
Datum vystavení: 01.09.2026
Datum splatnosti: 15.09.2026
Celkem bez DPH: 1000
DPH: 21 %
Celkem k úhradě: 1210`,
  fileUrl: "org/labels.pdf", organization, ocrConfidence: 96,
});

describe("OCR label to value association", () => {
  it.each([
    ["IČO: 02768054\nDIČ: CZ02768054"],
    ["IČO:\n02768054\nDIČ:\nCZ02768054"],
    ["Registration number:\n02768054\nTax identification number:\nCZ02768054"],
    ["Identifikátor firmy: 02768054\nDaňové číslo: CZ02768054"],
    ["I.Č.O.:\n02768054\nD.I.Č.:\nCZ02768054"],
    ["Identifikacni cis1o osoby:\n02768054\nDanove identifikacni cis1o:\nCZ02768054"],
  ])("reads customer identities on separate lines: %s", details => {
    const result = parse(details);
    expect(result.invoice.counterparty_ico).toBe("02768054");
    expect(result.invoice.counterparty_dic).toBe("CZ02768054");
    expect(result.field_sources.counterparty_ico?.text).toContain("02768054");
    expect(result.field_sources.counterparty_dic?.text).toContain("CZ02768054");
  });

  it("does not manufacture a missing VAT ID or borrow the supplier's", () => {
    const result = parse("IČO:\n02768054\nDIČ:\nE-mail: zakaznik@example.cz");
    expect(result.invoice.counterparty_ico).toBe("02768054");
    expect(result.invoice.counterparty_dic).toBe("");
    expect(result.invoice.counterparty_email).toBe("zakaznik@example.cz");
  });

  it("does not mistake a tax identification label for company registration", () => {
    const result = parse("Daňové identifikační číslo: CZ7311145842");
    expect(result.invoice.counterparty_ico).toBe("");
    expect(result.invoice.counterparty_dic).toBe("CZ7311145842");
  });

  it.each(["Fakturační měna: EUR", "Invoice currency:\nEUR", "Měna dokladu:\nEuro"])("reads a labeled currency: %s", label => {
    const result = parse(`IČO: 02768054\n${label}`);
    expect(result.invoice.currency).toBe("EUR");
    expect(result.field_sources.currency).toBeDefined();
  });

  it("holds back an unsupported currency on the next line", () => {
    expect(parse("IČO: 02768054\nMěna dokladu:\nINR").invoice.currency).toBe("");
  });

  it.each([false, true])("maps synonyms and OCR typos to their values (typos: %s)", typos => {
    const result = parseInvoiceText({
      text: `FAKTURA
Odběratel
Zákazník s.r.o.
IČO: 02768054
Document reference:
INV-2026-123
Reference platby:
2026123
${typos ? "Datum vystavenl" : "Issue date"}:
01.09.2026
${typos ? "Termin uhradv" : "Termín úhrady"}:
15.09.2026
Částka bez daně:
1000,00
DPH: 21 %
Total including VAT:
1210,00
Invoice currency:
EUR`,
      fileUrl: "org/synonyms.pdf", organization,
    });
    expect(result.invoice).toMatchObject({
      invoice_number: "INV-2026-123", variable_symbol: "2026123",
      issue_date: "2026-09-01", due_date: "2026-09-15",
      amount_without_vat: 1000, amount: 1210, currency: "EUR",
    });
  });

  it("does not take a neighboring labeled field as the missing value", () => {
    const result = parseInvoiceText({
      text: `FAKTURA\nDocument reference:\nReference platby: 2026123\nTermín úhrady:\nIssue date: 01.09.2026\nČástka bez daně:\nTotal including VAT: 1210 EUR`,
      fileUrl: "org/missing.pdf", organization,
    });
    expect(result.invoice.invoice_number).toBe("");
    expect(result.invoice.due_date).toBe("");
    expect(result.field_sources.amount_without_vat?.method).not.toBe("pdf_text");
  });
});
