import { describe, expect, it } from "vitest";
import {
  assignStatementPayments,
  type AssignablePayment,
} from "./statement-assignment";
import type { MatchableInvoice } from "./payment-matching";

const invoice = (
  id: string,
  amount: number,
  overrides: Partial<MatchableInvoice> = {},
): MatchableInvoice => ({
  id,
  invoice_number: id,
  counterparty_name: "Firma s.r.o.",
  counterparty_ico: "111",
  variable_symbol: null,
  currency: "CZK",
  amount,
  paid_amount: 0,
  issue_date: "2026-09-01",
  ...overrides,
});

const payment = (
  key: string,
  amount: number,
  overrides: Partial<AssignablePayment> = {},
): AssignablePayment => ({
  key,
  amount,
  currency: "CZK",
  variable_symbol: null,
  counterparty_name: "Firma s.r.o.",
  counterparty_account: null,
  booked_on: "2026-09-15",
  ...overrides,
});

describe("statement assignment (one payment, one invoice)", () => {
  // The real 20260915.gpc statement, paired against the invoices that exist
  // for it. Built from the actual file rather than from round numbers,
  // because the whole point is what this decides on real bank data.
  const realPayments = [
    payment("l2", 99, { variable_symbol: "0", counterparty_name: "MOJE ODMENY", counterparty_account: "0" }),
    payment("l3", 726, { variable_symbol: "426219", counterparty_name: "MANAGETOGETHER S.R", counterparty_account: "7330022938000000" }),
    payment("l4", 726, { variable_symbol: "308", counterparty_name: "Roman Bahyrian", counterparty_account: "6018226376000000" }),
    payment("l5", 2420, { variable_symbol: "0", counterparty_name: "ESTIMATIC SYSTEMS S.", counterparty_account: "7214662570000107" }),
    payment("l6", 3750, { variable_symbol: "308", counterparty_name: "Roman Bahyrian", counterparty_account: "6018226376000000" }),
    payment("l7", 4538, { variable_symbol: "260635", counterparty_name: "MANAGETOGETHER S.R", counterparty_account: "7330022938000000" }),
    payment("l8", 9680, { variable_symbol: "0", counterparty_name: "ESTIMATIC SYSTEMS S.", counterparty_account: "7214662570000107" }),
    payment("l9", 15418, { variable_symbol: "260611", counterparty_name: "C.S.CARGO A.S.", counterparty_account: "3514011780000000" }),
    payment("l10", 15660, { variable_symbol: "260610", counterparty_name: "C.S.CARGO A.S.", counterparty_account: "3514011780000000" }),
  ];
  const realInvoices = [
    invoice("260610", 15660, { counterparty_name: "C.S.CARGO a.s.", counterparty_ico: "64259374" }),
    invoice("260611", 15418, { counterparty_name: "C.S.CARGO a.s.", counterparty_ico: "64259374" }),
    invoice("260622", 9680, { counterparty_name: "ESTIMATIC Systems s.r.o.", counterparty_ico: "09876543" }),
    invoice("260627", 3750, { counterparty_name: "Tetiana Bahyrian", counterparty_ico: "17654321" }),
  ];

  it("books the two identifier matches automatically", () => {
    const result = assignStatementPayments(realPayments, realInvoices);
    for (const [key, invoiceId] of [["l10", "260610"], ["l9", "260611"]] as const) {
      expect(result.get(key)?.proposal).toEqual(
        expect.objectContaining({
          kind: "exact",
          confidence: "safe",
          invoiceIds: [invoiceId],
        }),
      );
      expect(result.get(key)?.tier).toBe("identifier");
    }
  });

  it("prefers the confirmed account over the payer's name for a VS-less payment", () => {
    // ESTIMATIC pays 9 680 with VS 0 -- there is no identifier at all. The name
    // tier books it either way (the owner enabled that), but a confirmed account
    // is the stronger evidence and must be the one that gets recorded as the
    // reason, because it is the one that actually identifies the customer.
    const withoutHistory = assignStatementPayments(realPayments, realInvoices);
    expect(withoutHistory.get("l8")?.tier).toBe("name");

    const withHistory = assignStatementPayments(
      realPayments,
      realInvoices,
      new Map([["7214662570000107", ["09876543"]]]),
    );
    expect(withHistory.get("l8")?.proposal).toEqual(
      expect.objectContaining({
        kind: "exact",
        confidence: "safe",
        invoiceIds: ["260622"],
      }),
    );
    expect(withHistory.get("l8")?.tier).toBe("account");
  });

  it("only suggests when the payer is not the counterparty", () => {
    // Roman Bahyrian pays an invoice issued to Tetiana Bahyrian. The amount is
    // exact, but a different person's name is not enough to book money on.
    const result = assignStatementPayments(realPayments, realInvoices);
    expect(result.get("l6")?.proposal).toEqual(
      expect.objectContaining({ confidence: "review", invoiceIds: ["260627"] }),
    );
    expect(result.get("l6")?.tier).toBe("amount");
  });

  it("leaves payments with no matching invoice entirely alone", () => {
    const result = assignStatementPayments(realPayments, realInvoices);
    for (const key of ["l2", "l3", "l4", "l5", "l7"])
      expect(result.has(key)).toBe(false);
  });

  it("never lets two payments claim the same invoice", () => {
    // Two identical 5 000 payments, one open invoice for 5 000. Row-by-row
    // matching would mark both "safe" against it and double-pay the invoice.
    const result = assignStatementPayments(
      [
        payment("a", 5000, { counterparty_name: "Firma s.r.o." }),
        payment("b", 5000, { counterparty_name: "Firma s.r.o." }),
      ],
      [invoice("x", 5000)],
    );
    for (const key of ["a", "b"]) {
      expect(result.get(key)?.proposal.confidence).toBe("review");
      expect(result.get(key)?.proposal.kind).toBe("ambiguous");
    }
  });

  it("never lets one payment claim two invoices", () => {
    const result = assignStatementPayments(
      [payment("a", 5000)],
      [invoice("x", 5000), invoice("y", 5000, { invoice_number: "y" })],
    );
    expect(result.get("a")?.proposal.kind).toBe("ambiguous");
    expect(result.get("a")?.proposal.invoiceIds.sort()).toEqual(["x", "y"]);
  });

  it("does not demote a strong match because a weak one also competes", () => {
    // The VS points unambiguously at x. That another invoice happens to cost
    // the same must not turn a certain match into a question.
    const result = assignStatementPayments(
      [payment("a", 5000, { variable_symbol: "5555" })],
      [
        invoice("x", 5000, { variable_symbol: "5555" }),
        invoice("y", 5000, { invoice_number: "y", counterparty_name: "Jina firma a.s." }),
      ],
    );
    expect(result.get("a")?.proposal).toEqual(
      expect.objectContaining({ confidence: "safe", invoiceIds: ["x"] }),
    );
  });

  it("frees the weaker candidate once a stronger payment has taken its invoice", () => {
    // Payment a matches x by VS. Payment b matches x only by amount -- but x
    // is gone, so b must not be left claiming an already-paid invoice.
    const result = assignStatementPayments(
      [
        payment("a", 5000, { variable_symbol: "5555" }),
        payment("b", 5000, { counterparty_name: "Jina firma a.s." }),
      ],
      [
        invoice("x", 5000, { variable_symbol: "5555" }),
        invoice("y", 5000, { invoice_number: "y", counterparty_name: "Jina firma a.s." }),
      ],
    );
    expect(result.get("a")?.proposal.invoiceIds).toEqual(["x"]);
    expect(result.get("b")?.proposal.invoiceIds).toEqual(["y"]);
  });

  it("ignores an invoice that is already fully paid", () => {
    const result = assignStatementPayments(
      [payment("a", 5000, { variable_symbol: "5555" })],
      [invoice("x", 5000, { variable_symbol: "5555", paid_amount: 5000 })],
    );
    expect(result.has("a")).toBe(false);
  });

  it("matches the remaining amount, not the invoice total", () => {
    const result = assignStatementPayments(
      [payment("a", 2000, { variable_symbol: "5555" })],
      [invoice("x", 5000, { variable_symbol: "5555", paid_amount: 3000 })],
    );
    expect(result.get("a")?.proposal).toEqual(
      expect.objectContaining({ confidence: "safe", invoiceIds: ["x"] }),
    );
  });

  it("keeps haler precision", () => {
    const result = assignStatementPayments(
      [payment("a", 15660.18, { variable_symbol: "5555" })],
      [
        invoice("x", 15660.18, { variable_symbol: "5555" }),
        invoice("y", 15660, { invoice_number: "y", variable_symbol: "5556" }),
      ],
    );
    expect(result.get("a")?.proposal.invoiceIds).toEqual(["x"]);
  });

  it("never matches across currencies", () => {
    const result = assignStatementPayments(
      [payment("a", 5000, { variable_symbol: "5555", currency: "EUR" })],
      [invoice("x", 5000, { variable_symbol: "5555", currency: "CZK" })],
    );
    expect(result.has("a")).toBe(false);
  });

  it("refuses a payment dated before the invoice was issued", () => {
    const result = assignStatementPayments(
      [payment("a", 5000, { booked_on: "2026-08-01" })],
      [invoice("x", 5000, { issue_date: "2026-09-01" })],
    );
    expect(result.has("a")).toBe(false);
  });

  it("still trusts an identifier match when dates are missing", () => {
    const result = assignStatementPayments(
      [payment("a", 5000, { variable_symbol: "5555", booked_on: null })],
      [invoice("x", 5000, { variable_symbol: "5555", issue_date: undefined })],
    );
    expect(result.get("a")?.proposal.confidence).toBe("safe");
  });
});
