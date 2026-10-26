import { describe, expect, it } from "vitest";
import { allocationIsValid, matchingState, paymentMatchesQuery } from "./payment-matching-presentation";
import type { Invoice, PreviewEntry } from "./payment-matching-types";

const entry: PreviewEntry = { line_number: 1, fingerprint: "one", disposition: "accepted", reason: null, amount: 100, currency: "CZK", booked_on: "2026-10-03", variable_symbol: "2600201", counterparty_name: "Český zákazník", counterparty_account: null, counterparty_account_verified: false, proposal_kind: "exact", proposal_confidence: "safe", proposal_reason: "VS i částka odpovídají.", proposed_invoice_ids: ["invoice"] };
const invoice: Invoice = { id: "invoice", invoice_number: "2600201", counterparty_name: "Český zákazník", amount: 100, paid_amount: 0, currency: "CZK", variable_symbol: "2600201" };
describe("payment matching presentation preserves actual state meanings", () => {
  it("distinguishes a safe proposal from booked money", () => {
    expect(matchingState(entry, [invoice.id], false)).toMatchObject({ tone: "safe", label: "Vysoká shoda" });
    expect(matchingState({ ...entry, bank_payment_id: "booked" }, [invoice.id], false)).toMatchObject({ tone: "booked", label: "Již zaúčtováno" });
  });
  it("does not call a manually changed safe proposal a high confidence match", () => {
    expect(matchingState(entry, ["other-invoice"], false).tone).toBe("review");
  });
  it.each(["ignored", "duplicate", "error"] as const)("keeps %s separate from an unmatched incoming payment", disposition => {
    const state = matchingState({ ...entry, disposition }, [], false);
    expect(state.label).not.toBe("Nespárováno");
    expect(allocationIsValid({ ...entry, disposition }, [invoice], 0, false, false)).toBe(false);
  });
  it("does not silently choose the first ambiguous proposal", () => {
    expect(matchingState({ ...entry, proposal_kind: "ambiguous", proposal_confidence: "review", proposed_invoice_ids: ["a", "b"] }, [], false).tone).toBe("review");
  });
  it("requires a valid invoice for row confirmation but allows an explicit unrelated decision", () => {
    expect(allocationIsValid(entry, [], 100, false, false)).toBe(false);
    expect(allocationIsValid(entry, [], 100, false, true)).toBe(true);
  });
  it("keeps partial, split, currency and overlap restrictions", () => {
    expect(allocationIsValid(entry, [invoice], 0, false, false)).toBe(true);
    expect(allocationIsValid(entry, [invoice], 20, false, false)).toBe(false);
    expect(allocationIsValid(entry, [invoice], 20, true, false)).toBe(true);
    expect(allocationIsValid(entry, [invoice], -20, true, false)).toBe(false);
    expect(allocationIsValid(entry, [{ ...invoice, currency: "EUR" }], 0, false, false)).toBe(false);
    expect(allocationIsValid({ ...entry, overlap_warning: true }, [invoice], 0, false, false)).toBe(false);
    expect(allocationIsValid({ ...entry, overlap_warning: true, overlap_acknowledged_by: "checked" }, [invoice], 0, false, false)).toBe(true);
  });
  it.each(["cesky zakaznik", "2600201", "100,00", "100"])("searches real payment fields: %s", query => {
    expect(paymentMatchesQuery(entry, query)).toBe(true);
  });
});
