import { describe, expect, it } from "vitest";
import { calculateCreation, creationUnitPrice, creationDocument, creationInput, parseCreationDraft, publicInvoiceDocument, supplierProblems } from "./invoice-creation";

import { fixture, supplier } from "@/test/invoice-creation-fixtures";
describe("issued invoices: exact shared calculations and validation", () => {
  it("retains unit price precision in customer-facing documents", () => {
    expect(creationUnitPrice("1,1234", "CZK")).toBe("1,1234 Kč");
    expect(creationUnitPrice("999999999999.1234", "CZK").replace(/\s/g, " ")).toBe("999 999 999 999,1234 Kč");
  });
  it("calculates the approved 21 % example", () => {
    expect(calculateCreation(fixture().items, true)).toMatchObject({ net: 50000, tax: 10500, gross: 60500 });
  });
  it("groups mixed rates and conserves every allocated haléř", () => {
    const a = fixture().items[0];
    const totals = calculateCreation([{ ...a, unit_price: "1000" }, { ...a, id: "second", unit_price: "500", vat_rate: 12 }], true);
    expect(totals).toMatchObject({ net: 1500, tax: 270, gross: 1770, breakdown: [{ rate: 21, net: 1000, tax: 210, gross: 1210 }, { rate: 12, net: 500, tax: 60, gross: 560 }] });
    const pennies = calculateCreation(Array.from({ length: 3 }, (_, i) => ({ ...a, id: String(i), unit_price: "0.03" })), true);
    expect(pennies.tax).toBe(.02);
    expect(pennies.lines.map(line => line.tax)).toEqual([.01, .01, 0]);
  });
  it("supports fractional quantities, unit discounts and non-payers", () => {
    const a = fixture().items[0];
    expect(calculateCreation([{ ...a, quantity: "3", unit_price: "100", discount: "10" }], true)).toMatchObject({ net: 270, tax: 56.7, gross: 326.7, discounts: 30 });
    expect(calculateCreation([{ ...a, quantity: "0,1", unit_price: "0,2" }], false)).toMatchObject({ net: .02, tax: 0, gross: .02, breakdown: [{ rate: null }] });
    expect(creationDocument(fixture(), { ...supplier, vat_payer: false, dic: "" }).totals.tax).toBe(0);
  });
  it.each([{ quantity: "0" }, { unit_price: "-10" }, { discount: "100.01" }, { quantity: "0.1234567" }, { unit_price: "1.12345" }, { vat_rate: -1 }, { vat_rate: 100.01 }, { vat_rate: 7.555 }, { vat_rate: Number.NaN }])("rejects unsupported line input %j", patch => {
    expect(() => calculateCreation([{ ...fixture().items[0], ...patch }], true)).toThrow();
  });
  it("supports zero and custom decimal VAT and preserves rounding across rows", () => {
    const a = fixture().items[0];
    const totals = calculateCreation([
      { ...a, unit: "licence", unit_price: "100", vat_rate: 0 },
      ...Array.from({ length: 3 }, (_, i) => ({ ...a, id: String(i), unit_price: "0.03", vat_rate: 7.5 })),
    ], true);
    expect(totals).toMatchObject({ net: 100.09, tax: .01, gross: 100.10 });
    expect(totals.lines.map(line => line.tax)).toEqual([0, .01, 0, 0]);
    expect(totals.breakdown).toMatchObject([{ rate: 0, tax: 0 }, { rate: 7.5, tax: .01 }]);
    expect(calculateCreation([{ ...a, unit_price: "100", vat_rate: 7.55 }], true).tax).toBe(7.55);
    expect(calculateCreation([{ ...a, unit_price: "100", vat_rate: 100 }], true).gross).toBe(200);
    const draft = fixture(); draft.items = totals.lines;
    expect(parseCreationDraft(draft).items[0].unit).toBe("licence");
    expect(creationDocument(draft, supplier).totals.tax).toBe(.01);
  });
  it("keeps issue date, DUZP, due date and numeric VS distinct", () => {
    const draft = fixture(); draft.tax_date = "2026-10-20";
    expect(creationDocument(draft, supplier).tax_date).toBe("2026-10-20");
    draft.variable_symbol = "FV-27"; expect(() => creationDocument(draft, supplier)).toThrow(/symbol/);
    draft.variable_symbol = "202627"; draft.tax_date = "2026-02-30"; expect(() => creationDocument(draft, supplier)).toThrow(/datum/);
  });
  it("allows issuing without email, but blocks unknown VAT status, missing identity and foreign-currency VAT", () => {
    const draft = fixture(); draft.customer.email = "";
    expect(creationInput(creationDocument(draft, supplier)).counterparty_email).toBe("");
    expect(supplierProblems({ ...supplier, vat_payer: null })).toContain("údaj o plátcovství DPH");
    expect(() => creationDocument(draft, { ...supplier, address: "" })).toThrow(/sídlo/);
    draft.currency = "EUR"; expect(() => creationDocument(draft, supplier)).toThrow(/kurz/);
  });
  it("does not trust client supplier, organization or totals and never projects internal notes", () => {
    const draft = fixture(); draft.internal_note = "PRIVATE-INTERNAL-SECRET";
    const parsed = parseCreationDraft({ ...draft, organization_id: "other", supplier: { name: "Forgery" }, totals: { gross: 1 } });
    expect(parsed).not.toHaveProperty("organization_id");
    const document = creationDocument(parsed, supplier);
    expect(document.supplier.name).toBe(supplier.name);
    expect(document.totals.gross).toBe(60500);
    expect(JSON.stringify(publicInvoiceDocument(document))).not.toContain("PRIVATE-INTERNAL-SECRET");
    expect(() => creationDocument(draft, { ...supplier, bank_account_czk: "" })).toThrow(/účet/);
  });
  it("does not require a bank account for cash", () => {
    const draft = fixture(); draft.payment_method = "cash";
    expect(creationDocument(draft, { ...supplier, bank_account_czk: "" }).payment_account).toBe("");
  });
});
