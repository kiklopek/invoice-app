import { describe, expect, it } from "vitest";
import { isIsoDate, parseInvoiceInput } from "./invoice-validation";

const validInvoice = {
  invoice_number: " FV-2026-001 ",
  counterparty_name: " Odběratel s.r.o. ",
  counterparty_email: " FAKTURACE@example.cz ",
  amount_without_vat: 1000,
  vat_rate: 21,
  amount: 1210,
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
      amount_without_vat: 1000,
      vat_rate: 21,
      amount: 1210,
      currency: "CZK",
    });
  });

  it("odmítne obrácenou splatnost, neplatnou měnu a příliš vysokou částku", () => {
    expect(parseInvoiceInput({ ...validInvoice, due_date: "2026-07-31" })).toBeNull();
    expect(parseInvoiceInput({ ...validInvoice, currency: "Kč" })).toBeNull();
    expect(parseInvoiceInput({ ...validInvoice, amount: 1_000_000_000_000 })).toBeNull();
    expect(parseInvoiceInput({ ...validInvoice, amount: 1200 })).toBeNull();
    expect(parseInvoiceInput({ ...validInvoice, vat_rate: 101 })).toBeNull();
  });

  it("zachová kompatibilitu se starým vstupem obsahujícím pouze konečnou částku", () => {
    const { amount_without_vat: _net, vat_rate: _rate, ...legacyInvoice } = validInvoice;
    expect(parseInvoiceInput(legacyInvoice)).toMatchObject({ amount_without_vat: 1210, vat_rate: 0, amount: 1210 });
  });

  it("odmítne nadlimitní text namísto tichého zkrácení", () => {
    expect(parseInvoiceInput({ ...validInvoice, invoice_number: "x".repeat(101) })).toBeNull();
    expect(parseInvoiceInput({ ...validInvoice, notes: "x".repeat(5001) })).toBeNull();
  });
});
