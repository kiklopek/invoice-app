import type { MatchableInvoice } from "@/lib/payment-matching";
import type { StatementRow } from "@/lib/statement-proposals";

/**
 * Kontrolní sada výpisů: typické i okrajové situace párování s přesně
 * očekávaným výsledkem. Každá změna párovací logiky se na ní musí projevit
 * vědomě (úpravou očekávání v testu), nikdy tiše.
 */
const inv = (id: string, amount: number, o: Partial<MatchableInvoice> = {}): MatchableInvoice => ({
  id, invoice_number: id, counterparty_name: "Odběratel s.r.o.", counterparty_ico: "11111111", variable_symbol: null,
  currency: "CZK", amount, paid_amount: 0, issue_date: "2026-10-01", due_date: "2026-10-15", ...o,
});
const pay = (fingerprint: string, amount: number, o: Partial<NonNullable<StatementRow["payment"]>> = {}): StatementRow => ({
  fingerprint, disposition: "accepted",
  payment: { amount, currency: "CZK", variable_symbol: null, counterparty_name: null, counterparty_account: null, booked_on: "2026-10-20", note: null, ...o },
});

export const goldenInvoices: MatchableInvoice[] = [
  inv("vs-exact", 1210, { variable_symbol: "2600101", counterparty_name: "ACME s.r.o.", counterparty_ico: "22222222" }),
  inv("vs-zeros", 3750, { variable_symbol: "2600102", counterparty_name: "Beta a.s.", counterparty_ico: "33333333" }),
  inv("2026/045", 5000, { counterparty_name: "Gama spol. s r.o.", counterparty_ico: "44444444" }),
  inv("dup-vs-a", 800, { variable_symbol: "777", counterparty_name: "Delta s.r.o.", counterparty_ico: "55555555" }),
  inv("dup-vs-b", 800, { variable_symbol: "777", counterparty_name: "Delta s.r.o.", counterparty_ico: "55555555" }),
  inv("account", 2400, { variable_symbol: "2600110", counterparty_name: "Epsilon s.r.o.", counterparty_ico: "66666666" }),
  inv("partial", 10000, { variable_symbol: "2600120", counterparty_name: "Zeta s.r.o.", counterparty_ico: "77777777" }),
  inv("over", 1000, { variable_symbol: "2600130", counterparty_name: "Eta s.r.o.", counterparty_ico: "88888888" }),
  inv("combo-a", 600, { variable_symbol: "2600140", counterparty_name: "Theta s.r.o.", counterparty_ico: "99999999" }),
  inv("combo-b", 400, { variable_symbol: "2600141", counterparty_name: "Theta s.r.o.", counterparty_ico: "99999999" }),
  inv("rounding", 10000, { variable_symbol: "2600150", counterparty_name: "Iota s.r.o.", counterparty_ico: "12121212" }),
  inv("eur", 500, { variable_symbol: "2600160", currency: "EUR", counterparty_name: "Kappa GmbH", counterparty_ico: "13131313" }),
  inv("twice", 1500, { variable_symbol: "2600170", counterparty_name: "Lambda s.r.o.", counterparty_ico: "14141414" }),
  inv("amount-only", 4321, { variable_symbol: "2600180", counterparty_name: "Mu s.r.o.", counterparty_ico: "15151515" }),
  inv("name-only", 2222, { variable_symbol: "2600190", counterparty_name: "Dřevostavby Novák s.r.o.", counterparty_ico: "16161616" }),
];

export const goldenSettled: MatchableInvoice[] = [
  inv("already-paid", 900, { variable_symbol: "2600199", paid_amount: 900, counterparty_name: "Nu s.r.o.", counterparty_ico: "17171717" }),
];

export const goldenKnownAccounts = [{ account_number: "19-2000145399/0800", counterparty_ico: "66666666" }];
export const goldenOwnAccounts = ["2400123456/2010"];

export const goldenRows: StatementRow[] = [
  pay("vs-exact", 1210, { variable_symbol: "2600101", counterparty_name: "ACME S.R.O." }),
  pay("vs-zeros", 3750, { variable_symbol: "0002600102" }),
  pay("vs-is-number", 5000, { variable_symbol: "2026045" }),
  pay("dup-vs", 800, { variable_symbol: "777" }),
  pay("account", 2400, { counterparty_account: "19-2000145399/0800" }),
  pay("partial", 4000, { variable_symbol: "2600120" }),
  pay("over", 1200, { variable_symbol: "2600130" }),
  pay("combo", 1000, { counterparty_name: "THETA S.R.O." }),
  pay("rounding", 9999.4, { variable_symbol: "2600150" }),
  pay("eur-in-czk", 500, { variable_symbol: "2600160" }),
  pay("twice-1", 1500, { variable_symbol: "2600170" }),
  pay("twice-2", 1500, { variable_symbol: "2600170" }),
  pay("amount-only", 4321),
  pay("name-only", 2222, { counterparty_name: "DREVOSTAVBY NOVAK" }),
  pay("already-paid", 900, { variable_symbol: "2600199" }),
  pay("own-transfer", 50000, { variable_symbol: "2600101", counterparty_account: "2400123456/2010" }),
  pay("unknown", 123.45),
  { fingerprint: "ignored", disposition: "ignored", payment: null },
];
