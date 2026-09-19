import { describe, expect, it } from "vitest";
import {
  assignStatementPayments,
  referencesInvoiceNumber,
  type AssignablePayment,
} from "./statement-assignment";
import type { MatchableInvoice } from "./payment-matching";

/**
 * The rules that decide whether money moves without a human. Each case here is
 * a situation where an amount that happens to line up would otherwise stand in
 * for evidence that was never actually there.
 */

const invoice = (
  over: Partial<MatchableInvoice> & Pick<MatchableInvoice, "id" | "invoice_number">,
): MatchableInvoice => ({
  counterparty_name: "C.S.CARGO a.s.",
  counterparty_ico: "64259374",
  variable_symbol: null,
  currency: "CZK",
  amount: 1000,
  paid_amount: 0,
  issue_date: "2026-09-02",
  due_date: "2026-09-16",
  ...over,
});

const payment = (over: Partial<AssignablePayment> & Pick<AssignablePayment, "key">): AssignablePayment => ({
  amount: 1000,
  currency: "CZK",
  booked_on: "2026-09-15",
  ...over,
});

const decide = (
  payments: AssignablePayment[],
  invoices: MatchableInvoice[],
  accounts = new Map<string, string[]>(),
  settled: MatchableInvoice[] = [],
) => assignStatementPayments(payments, invoices, accounts, settled);

describe("invoice number written in the payment message", () => {
  it("does not match a number glued inside a longer one", () => {
    expect(referencesInvoiceNumber("GPC doklad 091500001234567", "1234")).toBe(false);
    expect(referencesInvoiceNumber("Faktura 1234", "1234")).toBe(true);
    expect(referencesInvoiceNumber("platba 1234, 5678", "5678")).toBe(true);
  });

  it("ignores numbers too short to be distinctive in free text", () => {
    expect(referencesInvoiceNumber("platba za 12 kusu", "12")).toBe(false);
  });

  it("books a payment whose message names the invoice and whose amount is exact", () => {
    const decided = decide(
      [payment({ key: "p1", note: "uhrada faktury 260610" })],
      [invoice({ id: "a", invoice_number: "260610" })],
    );
    expect(decided.get("p1")).toMatchObject({
      tier: "reference",
      proposal: { confidence: "safe", invoiceIds: ["a"] },
    });
  });

  it("refuses when the message names more invoices than the payment can settle", () => {
    const decided = decide(
      [payment({ key: "p1", note: "faktury 260610 a 260611" })],
      [
        invoice({ id: "a", invoice_number: "260610" }),
        invoice({ id: "b", invoice_number: "260611" }),
      ],
    );
    expect(decided.get("p1")?.proposal.confidence).toBe("review");
    expect(decided.get("p1")?.proposal.invoiceIds).toEqual(["a", "b"]);
  });
});

describe("conflicting identifiers", () => {
  it("never picks the reading that fits the amount", () => {
    const decided = decide(
      [payment({ key: "p1", variable_symbol: "260610", note: "faktura 260611" })],
      [
        // The symbol names this one; the amount does not fit it.
        invoice({ id: "a", invoice_number: "260610", amount: 999 }),
        // The message names this one, and the amount fits perfectly.
        invoice({ id: "b", invoice_number: "260611", amount: 1000 }),
      ],
    );
    expect(decided.get("p1")).toMatchObject({ tier: "conflict" });
    expect(decided.get("p1")?.proposal.confidence).toBe("review");
    expect(decided.get("p1")?.proposal.invoiceIds.sort()).toEqual(["a", "b"]);
  });

  it("is not a conflict when both identifiers name the same invoice", () => {
    const decided = decide(
      [payment({ key: "p1", variable_symbol: "260610", note: "faktura 260610" })],
      [invoice({ id: "a", invoice_number: "260610" })],
    );
    expect(decided.get("p1")).toMatchObject({
      tier: "identifier",
      proposal: { confidence: "safe", invoiceIds: ["a"] },
    });
  });
});

describe("one variable symbol on several open invoices", () => {
  it("stops instead of choosing the one whose amount matches", () => {
    const decided = decide(
      [payment({ key: "p1", variable_symbol: "555" })],
      [
        invoice({ id: "a", invoice_number: "A1", variable_symbol: "555", amount: 1000 }),
        invoice({ id: "b", invoice_number: "B1", variable_symbol: "555", amount: 2500 }),
      ],
    );
    expect(decided.get("p1")?.proposal.confidence).toBe("review");
    expect(decided.get("p1")?.proposal.invoiceIds.sort()).toEqual(["a", "b"]);
  });
});

describe("a payer account confirmed for more than one customer", () => {
  const accountOfTwo = new Map([["CZ99", ["64259374", "02768054"]]]);

  it("does not book on the shared account alone", () => {
    const decided = decide(
      [payment({ key: "p1", counterparty_account: "CZ99" })],
      [invoice({ id: "a", invoice_number: "260610" })],
      accountOfTwo,
    );
    // Falls back to the weakest evidence there is -- a unique amount -- which
    // is a suggestion for a human, never an automatic booking.
    expect(decided.get("p1")).toMatchObject({
      tier: "amount",
      proposal: { confidence: "review" },
    });
  });

  it("still books when that same account identifies exactly one customer", () => {
    const decided = decide(
      [payment({ key: "p1", counterparty_account: "CZ99" })],
      [invoice({ id: "a", invoice_number: "260610" })],
      new Map([["CZ99", ["64259374", "64259374"]]]),
    );
    expect(decided.get("p1")).toMatchObject({
      tier: "account",
      proposal: { confidence: "safe", invoiceIds: ["a"] },
    });
  });
});

describe("a payment quoting an invoice that is already settled", () => {
  it("reports it instead of silently finding nothing", () => {
    const decided = decide(
      [payment({ key: "p1", variable_symbol: "260610" })],
      [invoice({ id: "other", invoice_number: "260699", amount: 4321 })],
      new Map(),
      [invoice({ id: "paid", invoice_number: "260610", paid_amount: 1000 })],
    );
    expect(decided.get("p1")).toMatchObject({
      tier: "settled",
      proposal: { confidence: "review", invoiceIds: ["paid"] },
    });
    expect(decided.get("p1")?.proposal.reason).toMatch(/uhrazen/i);
  });

  it("does not warn when the symbol still names an open invoice", () => {
    const decided = decide(
      [payment({ key: "p1", variable_symbol: "260610" })],
      [invoice({ id: "open", invoice_number: "260610" })],
      new Map(),
      [invoice({ id: "paid", invoice_number: "260610", paid_amount: 1000 })],
    );
    expect(decided.get("p1")).toMatchObject({
      tier: "identifier",
      proposal: { confidence: "safe", invoiceIds: ["open"] },
    });
  });
});

describe("name plus exact amount, enabled for unattended booking", () => {
  const estimatic = (over: Partial<MatchableInvoice> = {}) =>
    invoice({
      id: "e1",
      invoice_number: "260622",
      counterparty_name: "ESTIMATIC Systems s.r.o.",
      counterparty_ico: "02768054",
      ...over,
    });

  it("books when the bank-truncated payer name agrees and the amount is exact", () => {
    const decided = decide(
      [payment({ key: "p1", counterparty_name: "ESTIMATIC SYSTEMS S." })],
      [estimatic()],
    );
    expect(decided.get("p1")).toMatchObject({
      tier: "name",
      proposal: { confidence: "safe", invoiceIds: ["e1"] },
    });
  });

  it("refuses a name too short to distinguish anyone", () => {
    // "NOVAK" against "NOVAKOVA" agrees on five characters. That is a surname,
    // not an identification, and it must not move money.
    const decided = decide(
      [payment({ key: "p1", counterparty_name: "Novak" })],
      [invoice({ id: "n1", invoice_number: "1", counterparty_name: "Novakova" })],
    );
    expect(decided.get("p1")?.tier).toBe("amount");
  });

  it("refuses when two customers share the agreeing name prefix", () => {
    const decided = decide(
      [payment({ key: "p1", counterparty_name: "ESTIMATIC SYSTEMS S." })],
      [estimatic(), estimatic({ id: "e2", invoice_number: "260623" })],
    );
    expect(decided.get("p1")?.proposal.confidence).toBe("review");
    expect(decided.get("p1")?.proposal.invoiceIds.sort()).toEqual(["e1", "e2"]);
  });

  it("refuses a payment dated before the invoice was issued", () => {
    const decided = decide(
      [payment({ key: "p1", counterparty_name: "ESTIMATIC SYSTEMS S.", booked_on: "2026-08-01" })],
      [estimatic()],
    );
    // No tier holds, so this pass declines to judge it at all and the row-by-row
    // matcher takes over. What matters is that nothing here books it.
    expect(decided.get("p1")).toBeUndefined();
  });

  it("does not let two payers of the same amount both take the invoice", () => {
    const decided = decide(
      [
        payment({ key: "p1", counterparty_name: "ESTIMATIC SYSTEMS S." }),
        payment({ key: "p2", counterparty_name: "ESTIMATIC SYSTEMS S." }),
      ],
      [estimatic()],
    );
    expect(decided.get("p1")?.proposal.confidence).toBe("review");
    expect(decided.get("p2")?.proposal.confidence).toBe("review");
  });
});

describe("one payment settling several of the payer's invoices", () => {
  const acme = (over: Partial<MatchableInvoice> & Pick<MatchableInvoice, "id" | "amount">) =>
    invoice({
      invoice_number: `n-${over.id}`,
      counterparty_name: "ACME Industries s.r.o.",
      counterparty_ico: "11111111",
      due_date: "2026-09-16",
      ...over,
    });

  it("books every invoice when exactly one subset adds up", () => {
    const decided = decide(
      [payment({ key: "p1", counterparty_name: "ACME INDUSTRIES S.", amount: 6000 })],
      [acme({ id: "a", amount: 1000 }), acme({ id: "b", amount: 2000 }), acme({ id: "c", amount: 3000 })],
    );
    expect(decided.get("p1")?.tier).toBe("name_combination");
    expect(decided.get("p1")?.proposal.confidence).toBe("safe");
    expect([...decided.get("p1")!.proposal.invoiceIds].sort()).toEqual(["a", "b", "c"]);
  });

  it("refuses when two different subsets reach the same total", () => {
    // 4000 is either {a,b} or {c,d}. No single invoice matches, so nothing
    // stronger settles it -- and guessing would mark invoices paid that the
    // customer never settled.
    const decided = decide(
      [payment({ key: "p1", counterparty_name: "ACME INDUSTRIES S.", amount: 4000 })],
      [
        acme({ id: "a", amount: 1000 }),
        acme({ id: "b", amount: 3000 }),
        acme({ id: "c", amount: 2000 }),
        acme({ id: "d", amount: 2000 }),
      ],
    );
    expect(decided.get("p1")?.proposal.confidence).toBe("review");
    expect(decided.get("p1")?.proposal.reason).toMatch(/více různých kombinac/i);
  });

  it("never reaches across to another customer's invoices", () => {
    const decided = decide(
      [payment({ key: "p1", counterparty_name: "ACME INDUSTRIES S.", amount: 6000 })],
      [
        acme({ id: "a", amount: 1000 }),
        acme({ id: "b", amount: 2000 }),
        // Same amount, different customer -- completing the sum with it would
        // settle a stranger's invoice.
        invoice({ id: "other", invoice_number: "x", counterparty_name: "Beta Trading s.r.o.", amount: 3000 }),
      ],
    );
    expect(decided.get("p1")?.proposal.confidence).toBe("review");
    expect(decided.get("p1")?.proposal.invoiceIds).not.toContain("other");
  });

  it("leaves out invoices issued after the payment arrived", () => {
    const decided = decide(
      [payment({ key: "p1", counterparty_name: "ACME INDUSTRIES S.", amount: 6000, booked_on: "2026-09-10" })],
      [
        acme({ id: "a", amount: 1000 }),
        acme({ id: "b", amount: 2000 }),
        acme({ id: "late", amount: 3000, issue_date: "2026-09-20" }),
      ],
    );
    expect(decided.get("p1")?.proposal.confidence).toBe("review");
    expect(decided.get("p1")?.proposal.invoiceIds).not.toContain("late");
  });

  it("does not let two payments claim the same invoice in their combinations", () => {
    const decided = decide(
      [
        payment({ key: "p1", counterparty_name: "ACME INDUSTRIES S.", amount: 3000 }),
        payment({ key: "p2", counterparty_name: "ACME INDUSTRIES S.", amount: 3000 }),
      ],
      [acme({ id: "a", amount: 1000 }), acme({ id: "b", amount: 2000 })],
    );
    expect(decided.get("p1")?.proposal.confidence).toBe("review");
    expect(decided.get("p2")?.proposal.confidence).toBe("review");
  });

  it("offers the customer's invoices when no subset adds up at all", () => {
    const decided = decide(
      [payment({ key: "p1", counterparty_name: "ACME INDUSTRIES S.", amount: 5000 })],
      [acme({ id: "a", amount: 3000, due_date: "2026-09-30" }), acme({ id: "b", amount: 4000, due_date: "2026-09-10" })],
    );
    expect(decided.get("p1")?.proposal.confidence).toBe("review");
    expect(decided.get("p1")?.proposal.reason).toMatch(/záloh|částečn|přeplat/i);
    // Oldest due date first, so the review list reads in the order an
    // accountant would settle them.
    expect(decided.get("p1")?.proposal.invoiceIds).toEqual(["b", "a"]);
  });

  it("does not touch a payment whose name matches nobody", () => {
    const decided = decide(
      [payment({ key: "p1", counterparty_name: "Kdosi Neznamy", amount: 6000 })],
      [acme({ id: "a", amount: 1000 }), acme({ id: "b", amount: 2000 }), acme({ id: "c", amount: 3000 })],
    );
    expect(decided.get("p1")).toBeUndefined();
  });

  it("prefers a single exact invoice over assembling a combination", () => {
    const decided = decide(
      [payment({ key: "p1", counterparty_name: "ACME INDUSTRIES S.", amount: 3000 })],
      [acme({ id: "single", amount: 3000 }), acme({ id: "x", amount: 1000 }), acme({ id: "y", amount: 2000 })],
    );
    expect(decided.get("p1")?.tier).toBe("name");
    expect(decided.get("p1")?.proposal.invoiceIds).toEqual(["single"]);
  });
});
