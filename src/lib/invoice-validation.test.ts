import { describe, expect, it } from "vitest";
import { isIsoDate, parseInvoiceInput } from "./invoice-validation";

const validInvoice = {
  invoice_number: " FV-2026-001 ",
  counterparty_name: " Odběratel s.r.o. ",
  counterparty_email: " FAKTURACE@example.cz ",
  amount: 1234.567,
  currency: "czk",
  issue_date: "2026-08-01",
  due_date: "2026-08-15",
};

describe("isIsoDate", () => {
  it("rozliší skutečné a pouze formálně vypadající datum", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-2-8")).toBe(false);
  });
});

describe("parseInvoiceInput", () => {
  it("normalizuje bezpečný vstup a částku na haléře", () => {
    expect(parseInvoiceInput(validInvoice)).toMatchObject({
      invoice_number: "FV-2026-001",
      counterparty_name: "Odběratel s.r.o.",
      counterparty_email: "fakturace@example.cz",
      amount: 1234.57,
      currency: "CZK",
    });
  });

  it("odmítne obrácenou splatnost, neplatnou měnu a příliš vysokou částku", () => {
    expect(parseInvoiceInput({ ...validInvoice, due_date: "2026-07-31" })).toBeNull();
    expect(parseInvoiceInput({ ...validInvoice, currency: "Kč" })).toBeNull();
    expect(parseInvoiceInput({ ...validInvoice, amount: 1_000_000_000_000 })).toBeNull();
  });

  it("odmítne nadlimitní text namísto tichého zkrácení", () => {
    expect(parseInvoiceInput({ ...validInvoice, invoice_number: "x".repeat(101) })).toBeNull();
    expect(parseInvoiceInput({ ...validInvoice, notes: "x".repeat(5001) })).toBeNull();
  });
});

