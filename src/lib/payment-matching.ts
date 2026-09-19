import { normalizeVariableSymbol } from "./payment-import";
import { minorUnits } from "./money";

export interface MatchableInvoice {
  id: string;
  invoice_number: string;
  counterparty_name: string;
  counterparty_ico?: string | null;
  variable_symbol?: string | null;
  currency: string;
  amount: number;
  paid_amount: number;
  due_date?: string;
  issue_date?: string;
}

export interface MatchablePayment {
  amount: number;
  currency: string;
  variable_symbol?: string | null;
  counterparty_account?: string | null;
}

export type MatchProposal = {
  kind: "exact" | "combination" | "account_suggestion" | "ambiguous" | "manual";
  confidence: "safe" | "review";
  invoiceIds: string[];
  reason: string;
};

const cents = minorUnits;
const remaining = (invoice: MatchableInvoice) =>
  cents(invoice.amount) - cents(invoice.paid_amount);

export function exactCombinations(
  invoices: MatchableInvoice[],
  target: number,
  maximumInvoices = 12,
) {
  const ordered = invoices
    .filter((invoice) => remaining(invoice) > 0 && remaining(invoice) <= target)
    .sort((a, b) => remaining(b) - remaining(a) || a.id.localeCompare(b.id));
  if (ordered.length > 32)
    return { combinations: [] as string[][], complex: true };
  const suffix = new Array(ordered.length + 1).fill(0);
  for (let index = ordered.length - 1; index >= 0; index -= 1)
    suffix[index] = suffix[index + 1] + remaining(ordered[index]);
  const results: string[][] = [];
  let visited = 0;
  let exhausted = false;
  const walk = (index: number, sum: number, selected: string[]) => {
    if (++visited > 100_000) { exhausted = true; return; }
    if (results.length >= 2) return;
    if (sum === target) {
      if (selected.length > 0) results.push([...selected]);
      return;
    }
    if (
      index >= ordered.length ||
      sum > target ||
      selected.length >= maximumInvoices ||
      sum + suffix[index] < target
    )
      return;
    selected.push(ordered[index].id);
    walk(index + 1, sum + remaining(ordered[index]), selected);
    selected.pop();
    walk(index + 1, sum, selected);
  };
  walk(0, 0, []);
  return { combinations: exhausted ? [] : results, complex: exhausted };
}

// A payer routinely writes the invoice NUMBER into the payment's variable
// symbol when the invoice itself doesn't specify a separate VS -- common for
// invoice templates that never surface a "Variabilní symbol" field at all
// (so it's never captured, stays empty), yet are still purely numeric and so
// perfectly usable as a VS. Treating the invoice number as an equally valid
// identifier here, alongside the invoice's own variable_symbol field, is
// what actually lets a real payment like this get found at all.
function matchesVariableSymbol(invoice: MatchableInvoice, normalizedVs: string) {
  return (
    normalizeVariableSymbol(invoice.variable_symbol) === normalizedVs ||
    (!normalizeVariableSymbol(invoice.variable_symbol) && /^\d+$/.test(invoice.invoice_number.trim()) &&
      normalizeVariableSymbol(invoice.invoice_number) === normalizedVs)
  );
}

export function proposePaymentMatch(
  payment: MatchablePayment,
  rawInvoices: MatchableInvoice[],
  confirmedCounterpartyIcos: string[] = [],
): MatchProposal {
  // An invoice can now be found via two different keys (its own VS or its
  // invoice number) by whatever assembled this list upstream (see
  // invoicesByVs in the payments-imports route) -- dedupe by id so the same
  // invoice appearing twice never gets miscounted as two separate matches.
  const invoices = [...new Map(rawInvoices.map((invoice) => [invoice.id, invoice])).values()];
  const target = cents(payment.amount);
  const open = invoices.filter(
    (invoice) =>
      invoice.currency === payment.currency && remaining(invoice) > 0,
  );
  const normalizedVs = normalizeVariableSymbol(payment.variable_symbol);
  if (normalizedVs) {
    const vsMatches = open.filter((invoice) => matchesVariableSymbol(invoice, normalizedVs));
    const exact = vsMatches.filter((invoice) => remaining(invoice) === target);
    if (exact.length === 1) {
      if (confirmedCounterpartyIcos.length && !confirmedCounterpartyIcos.includes(exact[0].counterparty_ico ?? "")) {
        return { kind: "ambiguous", confidence: "review", invoiceIds: [exact[0].id], reason: "Identifikátor odpovídá, ale potvrzená historie bankovního účtu patří jinému odběrateli." };
      }
      return {
        kind: "exact",
        confidence: "safe",
        invoiceIds: [exact[0].id],
        reason: "Jedinečná shoda VS nebo čísla faktury, měny a přesné zbývající částky.",
      };
    }
    if (exact.length > 1) {
      return {
        kind: "ambiguous",
        confidence: "review",
        invoiceIds: exact.map((invoice) => invoice.id),
        reason: "Stejnému VS a částce odpovídá více faktur.",
      };
    }
    const counterparties = new Set(
      vsMatches.map(
        (invoice) => invoice.counterparty_ico || invoice.counterparty_name,
      ),
    );
    if (counterparties.size === 1) {
      const [counterparty] = counterparties;
      const group = open.filter(
        (invoice) =>
          (invoice.counterparty_ico || invoice.counterparty_name) ===
          counterparty,
      );
      const found = exactCombinations(group, target);
      if (found.combinations.length === 1)
        return {
          kind: "combination",
          confidence: "review",
          invoiceIds: found.combinations[0],
          reason: "Jedna přesná kombinace celých faktur stejného odběratele.",
        };
      if (found.combinations.length > 1)
        return {
          kind: "ambiguous",
          confidence: "review",
          invoiceIds: found.combinations[0],
          reason: "Existuje více přesných kombinací faktur.",
        };
      if (found.complex)
        return {
          kind: "manual",
          confidence: "review",
          invoiceIds: [],
          reason: "Výběr je příliš rozsáhlý pro bezpečný automatický návrh.",
        };
    }
  }

  if (normalizedVs) {
    const identified = open.filter(invoice => matchesVariableSymbol(invoice, normalizedVs));
    if (identified.length === 1) return {
      kind: "manual", confidence: "review", invoiceIds: [identified[0].id],
      reason: target < remaining(identified[0]) ? "Shoda identifikátoru; částečná úhrada vyžaduje potvrzení." : "Shoda identifikátoru; přeplatek vyžaduje potvrzení a ponechání nepřiřazeného zůstatku.",
    };
  }
  const known = new Set(confirmedCounterpartyIcos.filter(Boolean));
  if (known.size > 0) {
    const group = open.filter((invoice) =>
      known.has(invoice.counterparty_ico || ""),
    );
    const found = exactCombinations(group, target);
    if (found.combinations.length === 1)
      return {
        kind: "account_suggestion",
        confidence: "review",
        invoiceIds: found.combinations[0],
        reason:
          "Návrh podle uživatelem potvrzené historie účtu; vyžaduje kontrolu.",
      };
    if (found.combinations.length > 1)
      return {
        kind: "ambiguous",
        confidence: "review",
        invoiceIds: found.combinations[0],
        reason: "Historie účtu našla více možných kombinací.",
      };
  }
  return {
    kind: "manual",
    confidence: "review",
    invoiceIds: [],
    reason: normalizedVs
      ? "VS neodpovídá bezpečné úplné úhradě."
      : "Chybí VS a není k dispozici jednoznačný potvrzený návrh.",
  };
}

/** Demote every competing safe proposal, never choose a winner by row order. */
export function resolveBatchConflicts<T extends { proposal_confidence: string | null; proposed_invoice_ids: string[]; proposal_kind: string | null; proposal_reason: string | null }>(entries: T[]): T[] {
  const counts = new Map<string, number>();
  for (const entry of entries) if (entry.proposal_confidence === "safe")
    for (const id of entry.proposed_invoice_ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return entries.map(entry => entry.proposal_confidence === "safe" && entry.proposed_invoice_ids.some(id => (counts.get(id) ?? 0) > 1)
    ? { ...entry, proposal_confidence: "review", proposal_kind: "ambiguous", proposal_reason: "Více plateb v tomto výpisu nárokuje stejnou fakturu. Zkontrolujte společné přiřazení." }
    : entry);
}

export function validateAllocationTotal(
  paymentAmount: number,
  allocations: Array<{ amount: number }>,
  allowPartial: boolean,
) {
  const allocated = allocations.reduce(
    (sum, allocation) => sum + cents(allocation.amount),
    0,
  );
  const payment = cents(paymentAmount);
  if (allocated <= 0)
    return {
      valid: false,
      difference: payment / 100,
      reason: "Není vybraná žádná částka.",
    };
  if (allocated > payment)
    return {
      valid: false,
      difference: (payment - allocated) / 100,
      reason: "Součet přiřazení překračuje platbu.",
    };
  if (!allowPartial && allocated !== payment)
    return {
      valid: false,
      difference: (payment - allocated) / 100,
      reason: "Součet přiřazení musí přesně odpovídat platbě.",
    };
  return { valid: true, difference: (payment - allocated) / 100 };
}
