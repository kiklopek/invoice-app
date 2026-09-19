import { describe, expect, it } from "vitest";
import { parseGpc } from "./gpc-parser";
import { assignStatementPayments } from "./statement-assignment";
import type { MatchableInvoice } from "./payment-matching";

/**
 * A real KB statement (GPC/ABO, 128-byte fixed records) against the open
 * invoices it was paying. Reproduced from an import that matched nothing at
 * all, to pin down what the unattended path may and may not decide on its own.
 *
 * The decisive property of this statement is that NONE of the invoices carry a
 * variable_symbol of their own -- the issuing system never prints that field --
 * so every automatic match here has to come from the invoice NUMBER appearing
 * as the payment's VS.
 */

const pad = (value: string, width: number) => value.padEnd(width, " ").slice(0, width);
const digits = (value: string, width: number) => value.padStart(width, "0").slice(-width);

const OWN_ACCOUNT = "7252678640000000";

function transaction(options: {
  counterpartyAccount: string;
  amount: number;
  variableSymbol: string;
  counterpartyName: string;
  document: string;
  bankCode: string;
}) {
  return (
    "075" +
    OWN_ACCOUNT +
    digits(options.counterpartyAccount, 16) +
    digits(options.document, 13) +
    digits(String(Math.round(options.amount * 100)), 12) +
    "2" +
    digits(options.variableSymbol, 10) +
    // Constant-symbol field: KB carries the counterparty's bank code at its
    // third to sixth digit, and the real constant symbol in the last four.
    "00" + options.bankCode + "0308" +
    digits("", 10) +
    "000000" +
    pad(options.counterpartyName, 20) +
    "0" +
    "0000" +
    "150926"
  );
}

// A real KB+ export: IBAN prefix at 115-122 and the "MB" channel at 123-124
// are what mark this as the KM dialect, whose account numbers are permuted.
const header =
  "074" + OWN_ACCOUNT + pad("HLAVICA ROBERT", 20) + "140926" +
  pad("", 114 - 45) + "CZ340100" + "MB" + pad("", 4);

const statement = [
  header,
  // A bank cashback, not a customer payment: no counterparty account, no VS.
  transaction({ counterpartyAccount: "0", amount: 99, variableSymbol: "0", counterpartyName: "MOJE ODMENY", bankCode: "0100", document: "7" }),
  // Pays invoice 260611 in full, identified by the invoice number as VS.
  transaction({ counterpartyAccount: "3514011780000000", amount: 15418, variableSymbol: "260611", counterpartyName: "C.S.CARGO A.S.", bankCode: "0300", document: "3" }),
  // Pays invoice 260610 in full, same customer, same day, different amount.
  transaction({ counterpartyAccount: "3514011780000000", amount: 15660, variableSymbol: "260610", counterpartyName: "C.S.CARGO A.S.", bankCode: "0300", document: "4" }),
  // Exactly invoice 260622's amount but carries no usable VS at all -- only the
  // payer's (bank-truncated) name ties it to the invoice.
  transaction({ counterpartyAccount: "7214662570000107", amount: 9680, variableSymbol: "0", counterpartyName: "ESTIMATIC SYSTEMS S.", bankCode: "0100", document: "9" }),
  // Exactly invoice 260627's amount, but paid by a different person than the
  // invoice is issued to, under a VS that matches no invoice.
  transaction({ counterpartyAccount: "6018226376000000", amount: 3750, variableSymbol: "308", counterpartyName: "Roman Bahyrian", bankCode: "3030", document: "5" }),
  // Matches no open invoice by any signal.
  transaction({ counterpartyAccount: "7330022938000000", amount: 4538, variableSymbol: "260635", counterpartyName: "MANAGETOGETHER S.R", bankCode: "0600", document: "2" }),
].join("\r\n");

const invoices: MatchableInvoice[] = [
  { id: "i-260627", invoice_number: "260627", counterparty_name: "Tetiana Bahyrian", counterparty_ico: "23581140", variable_symbol: null, currency: "CZK", amount: 3750, paid_amount: 0, issue_date: "2026-09-02", due_date: "2026-09-16" },
  { id: "i-260622", invoice_number: "260622", counterparty_name: "ESTIMATIC Systems s.r.o.", counterparty_ico: "02768054", variable_symbol: null, currency: "CZK", amount: 9680, paid_amount: 0, issue_date: "2026-09-02", due_date: "2026-09-16" },
  { id: "i-260611", invoice_number: "260611", counterparty_name: "C.S.CARGO a.s.", counterparty_ico: "64259374", variable_symbol: null, currency: "CZK", amount: 15418, paid_amount: 0, issue_date: "2026-09-02", due_date: "2026-09-16" },
  { id: "i-260610", invoice_number: "260610", counterparty_name: "C.S.CARGO a.s.", counterparty_ico: "64259374", variable_symbol: null, currency: "CZK", amount: 15660, paid_amount: 0, issue_date: "2026-09-02", due_date: "2026-09-16" },
];

function decide(confirmedIcosByAccount = new Map<string, string[]>()) {
  const parsed = parseGpc(new TextEncoder().encode(statement));
  expect(parsed.entries.filter((entry) => entry.disposition === "error")).toEqual([]);
  const assignments = assignStatementPayments(
    parsed.entries.flatMap((entry) =>
      entry.payment && entry.disposition === "accepted"
        ? [{ key: entry.fingerprint, ...entry.payment }]
        : [],
    ),
    invoices,
    confirmedIcosByAccount,
  );
  return new Map(
    parsed.entries.flatMap((entry) => {
      const assigned = entry.payment ? assignments.get(entry.fingerprint) : undefined;
      return entry.payment
        ? [[
            `${entry.payment.amount}`,
            assigned
              ? { tier: assigned.tier, ...assigned.proposal }
              : { tier: null, confidence: null, invoiceIds: [] },
          ] as const]
        : [];
    }),
  );
}

describe("unattended matching of a real GPC statement", () => {
  it("books the invoices whose number the payer used as the variable symbol", () => {
    const decided = decide();
    expect(decided.get("15418")).toMatchObject({
      tier: "identifier",
      confidence: "safe",
      invoiceIds: ["i-260611"],
    });
    expect(decided.get("15660")).toMatchObject({
      tier: "identifier",
      confidence: "safe",
      invoiceIds: ["i-260610"],
    });
  });

  it("books a payment whose only link to the invoice is the payer's name", () => {
    // Enabled by the owner. The payment carries no usable symbol, so the name is
    // all there is -- and the booking says exactly that on the payment itself.
    const decided = decide();
    expect(decided.get("9680")).toMatchObject({
      tier: "name",
      confidence: "safe",
      invoiceIds: ["i-260622"],
    });
    const booked = decided.get("9680");
    expect(booked && "reason" in booked ? booked.reason : "").toMatch(/jména plátce/i);
    expect(booked && "reason" in booked ? booked.reason : "").toMatch(/variabilní symbol/i);
  });

  it("still never books on the amount alone", () => {
    // Right amount, but the payer is a different person than the invoice names,
    // so nothing connects this money to this invoice except its size.
    const decided = decide();
    expect(decided.get("3750")).toMatchObject({ tier: "amount", confidence: "review" });
  });

  it("leaves payments that match no open invoice entirely alone", () => {
    const decided = decide();
    expect(decided.get("99")).toMatchObject({ tier: null, invoiceIds: [] });
    expect(decided.get("4538")).toMatchObject({ tier: null, invoiceIds: [] });
  });

  it("books a payment with no usable VS once its account is a confirmed identity", () => {
    // This is the path the ledger learns by itself: the first ESTIMATIC payment
    // is confirmed by hand, which records the payer's account against that
    // customer, and every later payment from it needs no VS to book safely.
    // The key is the DECODED account: KB writes "7214662570000107" in its
    // internal format, which is a permutation, not the account number.
    const decided = decide(new Map([["107-6625740217/0100", ["02768054"]]]));
    expect(decided.get("9680")).toMatchObject({
      tier: "account",
      confidence: "safe",
      invoiceIds: ["i-260622"],
    });
    // The confirmed identity must not spill onto an unrelated payer.
    expect(decided.get("3750")).toMatchObject({ tier: "amount", confidence: "review" });
  });
});
