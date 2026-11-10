import { numericInvoiceNumber } from "@/lib/invoice-number";
import { normalizeVariableSymbol } from "@/lib/payment-import";
import { proposePaymentMatch, resolveBatchConflicts, type MatchableInvoice, type MatchProposal } from "@/lib/payment-matching";
import { detectOwnTransfer } from "@/lib/payment-unrelated-rows";
import {
  applyAutoBookingPolicy,
  assignStatementPayments,
  type AssignablePayment,
  type AutoBookingPolicy,
} from "@/lib/statement-assignment";

/**
 * Návrh přiřazení pro celý výpis. Jediné místo, které skládá rozhodnutí
 * celého výpisu (assignStatementPayments), politiku automatického zaúčtování
 * firmy a záložní návrh po řádcích (proposePaymentMatch); dřív žilo přímo
 * v POST /api/payments/imports. Čistá funkce bez databáze, takže ji testuje
 * kontrolní sada výpisů (statement-proposals.golden.test.ts).
 */
export type StatementRow = {
  fingerprint: string;
  disposition: string;
  payment: Omit<AssignablePayment, "key"> | null;
};

export type StatementProposal = {
  proposal_kind: MatchProposal["kind"] | null;
  proposal_confidence: MatchProposal["confidence"] | null;
  proposal_reason: string | null;
  proposed_invoice_ids: string[];
};

export function proposeStatement(input: {
  rows: StatementRow[];
  /** Otevřené faktury firmy (pending/overdue). */
  invoices: MatchableInvoice[];
  /** Už uhrazené faktury, na které výpis odkazuje svým VS. */
  settledInvoices?: MatchableInvoice[];
  /** Potvrzené účty plátců: číslo účtu -> IČO odběratelů. */
  knownAccounts?: { account_number: string; counterparty_ico: string }[];
  /** Účty firmy a účet tohoto výpisu: převod z nich není platba zákazníka. */
  ownAccounts?: string[];
  bookingPolicy: AutoBookingPolicy;
}): Map<string, StatementProposal> {
  const { rows, invoices, settledInvoices = [], knownAccounts = [], ownAccounts = [], bookingPolicy } = input;
  const icoByAccount = new Map<string, string[]>();
  for (const known of knownAccounts)
    icoByAccount.set(known.account_number, [...(icoByAccount.get(known.account_number) ?? []), known.counterparty_ico]);
  const invoicesByVs = new Map<string, MatchableInvoice[]>();
  const invoicesByCounterparty = new Map<string, MatchableInvoice[]>();
  for (const invoice of invoices) {
    const vsKey = `${invoice.currency}:${normalizeVariableSymbol(invoice.variable_symbol)}`;
    if (normalizeVariableSymbol(invoice.variable_symbol))
      invoicesByVs.set(vsKey, [...(invoicesByVs.get(vsKey) ?? []), invoice]);
    // Plátce často napíše do VS číslo faktury, když faktura vlastní VS nemá
    // (oddělovače povolené: „2026/001“ -> VS 2026001, viz invoice-number.ts).
    const numericNumber = numericInvoiceNumber(invoice.invoice_number);
    const numberKey = `${invoice.currency}:${normalizeVariableSymbol(numericNumber)}`;
    if (!normalizeVariableSymbol(invoice.variable_symbol) && numericNumber)
      invoicesByVs.set(numberKey, [...(invoicesByVs.get(numberKey) ?? []), invoice]);
    const counterpartyKey = invoice.counterparty_ico || invoice.counterparty_name;
    invoicesByCounterparty.set(counterpartyKey, [...(invoicesByCounterparty.get(counterpartyKey) ?? []), invoice]);
  }
  // Převod mezi vlastními účty automatika nepřiřazuje; rozhoduje jen protiúčet.
  const isOwnAccountTransfer = (payment: { amount: number; counterparty_account?: string | null }) =>
    detectOwnTransfer({
      disposition: "accepted",
      amount: payment.amount,
      counterparty_name: null,
      counterparty_account: payment.counterparty_account ?? null,
      counterparty_account_verified: true,
    }, { ownAccounts })?.kind === "account";
  const assignments = applyAutoBookingPolicy(assignStatementPayments(
    rows.flatMap((row) =>
      row.payment && row.disposition === "accepted" && !isOwnAccountTransfer(row.payment)
        ? [{ key: row.fingerprint, ...row.payment }]
        : [],
    ),
    invoices,
    icoByAccount,
    settledInvoices,
  ), bookingPolicy);
  const decided = resolveBatchConflicts(rows.map((row) => {
    // Převod z vlastního účtu není platba zákazníka: žádná faktura, i když VS
    // náhodou sedí. V kontrole se nabídne jako „Nesouvisí s fakturami“.
    if (row.payment && row.disposition === "accepted" && isOwnAccountTransfer(row.payment))
      return {
        fingerprint: row.fingerprint,
        proposal_kind: "manual" as const,
        proposal_confidence: "review" as const,
        proposal_reason: "Převod z vlastního účtu firmy – nesouvisí s fakturami.",
        proposed_invoice_ids: [] as string[],
      };
    const historyIcos = row.payment ? (icoByAccount.get(row.payment.counterparty_account ?? "") ?? []) : [];
    const assigned = assignments.get(row.fingerprint)?.proposal ?? null;
    const vsMatches = row.payment
      ? (invoicesByVs.get(`${row.payment.currency}:${normalizeVariableSymbol(row.payment.variable_symbol)}`) ?? [])
      : [];
    const directProposal = row.payment ? proposePaymentMatch(row.payment, vsMatches, historyIcos) : null;
    const relevant = new Map<string, MatchableInvoice>();
    for (const invoice of vsMatches) {
      relevant.set(invoice.id, invoice);
      for (const grouped of invoicesByCounterparty.get(invoice.counterparty_ico || invoice.counterparty_name) ?? [])
        relevant.set(grouped.id, grouped);
    }
    for (const ico of historyIcos)
      for (const grouped of invoicesByCounterparty.get(ico) ?? []) relevant.set(grouped.id, grouped);
    const candidate =
      assigned ??
      (directProposal?.kind === "exact" || directProposal?.kind === "ambiguous"
        ? directProposal
        : row.payment
          ? proposePaymentMatch(row.payment, [...relevant.values()], historyIcos)
          : null);
    const proposal = bookingPolicy === "off" && candidate?.confidence === "safe"
      ? { ...candidate, confidence: "review" as const, reason: `Ke kontrole: ${candidate.reason}` }
      : candidate;
    return {
      fingerprint: row.fingerprint,
      proposal_kind: proposal?.kind ?? null,
      proposal_confidence: proposal?.confidence ?? null,
      proposal_reason: proposal?.reason ?? null,
      proposed_invoice_ids: proposal?.invoiceIds ?? [],
    };
  }));
  return new Map(decided.map(({ fingerprint, ...proposal }) => [fingerprint, proposal]));
}
