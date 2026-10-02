import { describe, expect, it } from "vitest";
import { currencyMentions, normalizeInvoiceCurrency, unambiguousCurrency } from "./invoice-currency";
import { omitUnverifiedOcrValues, parseInvoiceText } from "./invoice-ocr";
import { geminiExtractionToResult } from "./invoice-ocr-gemini";

const organization = { name: "Moje firma s.r.o.", ico: "05829309", dic: "CZ05829309" };
const invoice = (total: string) => parseInvoiceText({
  text: `FAKTURA\nDodavatel: Moje firma s.r.o.\nIČO: 05829309\nOdběratel: Kupující s.r.o.\nIČO: 46692011\nČíslo faktury: FV-001\nDatum vystavení: 1. 9. 2026\nDatum splatnosti: 15. 9. 2026\nCelkem k úhradě: ${total}`,
  fileUrl: "org/faktura.pdf", organization,
});

describe("názvy měn na fakturách", () => {
  it.each([
    ["KC", "CZK"], ["KČ", "CZK"], ["koruna česká", "CZK"], ["českých korun", "CZK"],
    ["€", "EUR"], ["euro", "EUR"], ["US$", "USD"], ["amerických dolarů", "USD"],
    ["£", "GBP"], ["libra šterlinků", "GBP"], ["zł", "PLN"], ["polský zlotý", "PLN"],
    ["CHF", "CHF"], ["švýcarských franků", "CHF"],
    ["maďarský forint", "HUF"], ["švédská koruna", "SEK"], ["norská koruna", "NOK"],
    ["dánská koruna", "DKK"], ["rumunské lei", "RON"], ["japonský jen", "JPY"],
    ["kanadský dolar", "CAD"], ["australský dolar", "AUD"],
  ])("převede %s na %s", (alias, code) => {
    expect(normalizeInvoiceCurrency(alias)).toBe(code);
    expect(invoice(`1 210,00 ${alias}`).invoice.currency).toBe(code);
  });

  it("rozpozná i symbol před částkou a samostatný řádek měny vyžádá potvrzení", () => {
    expect(invoice("€ 1 210,00").invoice.currency).toBe("EUR");
    const result = parseInvoiceText({
      text: `FAKTURA\nMěna: polský zlotý\nDodavatel: Moje firma s.r.o.\nIČO: 05829309\nOdběratel: Kupující s.r.o.\nIČO: 46692011\nCelkem k úhradě: 1 210,00`,
      fileUrl: "org/faktura.pdf", organization,
    });
    expect(result.invoice.currency).toBe("PLN");
    expect(omitUnverifiedOcrValues(result).invoice.currency).toBe("PLN");
    expect(result.field_decisions.currency).toMatchObject({ status: "review", needs_confirmation: true });
  });

  it("nepovažuje část slova ani nejednoznačný dolar za měnu", () => {
    expect(currencyMentions("fakturace zákazník" )).toEqual([]);
    expect(unambiguousCurrency("Cena $ 120")).toBeNull();
    expect(normalizeInvoiceCurrency("$")).toBeNull();
  });

  it("sjednotí název měny i v odpovědi AI", () => {
    const result = geminiExtractionToResult({ currency: "koruna česká", amount: 1210 }, {
      organization, fileUrl: "org/faktura.pdf", model: "test", responseId: null,
    });
    expect(result.invoice.currency).toBe("CZK");
    expect(result.field_sources.currency?.method).toBe("ai");
  });

  it("rozporné měny nechá k výběru", () => {
    const result = invoice("1 210,00 EUR\nCelkem bez DPH: 1 000,00 Kč");
    expect(result.invoice.currency).toBe("");
    expect(result.field_decisions.currency?.status).toBe("review");
    expect(omitUnverifiedOcrValues(result).invoice.currency).toBe("");
  });

  it("neobnoví měnu z řádku částky, když doklad výslovně uvádí nepodporovanou měnu", () => {
    const result = parseInvoiceText({
      text: `FAKTURA\nMěna: RUB\nDodavatel: Moje firma s.r.o.\nIČO: 05829309\nOdběratel: Kupující s.r.o.\nIČO: 46692011\nCelkem k úhradě: 1 210,00 Kč`,
      fileUrl: "org/unsupported.pdf", organization,
    });
    expect(result.invoice.currency).toBe("");
    expect(result.field_decisions.currency?.reasons.join(" ")).toContain("RUB");
    expect(omitUnverifiedOcrValues(result).invoice.currency).toBe("");
  });

  it("jediný bezpečný návrh předvyplní a vyžádá potvrzení, odmítnutý ponechá prázdný", () => {
    const base = invoice("1 210,00 Kč");
    const candidate = { value: "faktury@kupujici.cz", page: 1, text: "E-mail: faktury@kupujici.cz", method: "pdf_text" as const, confidence: 0.9, role: "counterparty" as const };
    const proposed = {
      ...base,
      invoice: { ...base.invoice, counterparty_email: "" },
      field_decisions: { ...base.field_decisions, counterparty_email: { status: "review" as const, confidence: 0.5, reasons: [], candidates: [candidate] } },
    };
    const filled = omitUnverifiedOcrValues(proposed, organization);
    expect(filled.invoice.counterparty_email).toBe(candidate.value);
    expect(filled.field_decisions.counterparty_email).toMatchObject({ status: "review", needs_confirmation: true });
    expect(omitUnverifiedOcrValues({
      ...proposed,
      field_decisions: { ...proposed.field_decisions, counterparty_email: { ...proposed.field_decisions.counterparty_email, reasons: ["E-mail patří vystaviteli faktury"] } },
    }, organization).invoice.counterparty_email).toBe("");
  });
});
