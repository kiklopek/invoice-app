import { normalizeVariableSymbol } from "./payment-import";

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

const cents = (amount: number) => Math.round(amount * 100);
const remaining = (invoice: MatchableInvoice) =>
  cents(Number(invoice.amount) - Number(invoice.paid_amount));

function exactCombinations(
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
  const walk = (index: number, sum: number, selected: string[]) => {
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
  return { combinations: results, complex: false };
}

export function proposePaymentMatch(
  payment: MatchablePayment,
  invoices: MatchableInvoice[],
  confirmedCounterpartyIcos: string[] = [],
): MatchProposal {
  const target = cents(payment.amount);
  const open = invoices.filter(
    (invoice) =>
      invoice.currency === payment.currency && remaining(invoice) > 0,
  );
  const normalizedVs = normalizeVariableSymbol(payment.variable_symbol);
  if (normalizedVs) {
    const vsMatches = open.filter(
      (invoice) =>
        normalizeVariableSymbol(invoice.variable_symbol) === normalizedVs,
    );
    const exact = vsMatches.filter((invoice) => remaining(invoice) === target);
    if (exact.length === 1) {
      return {
        kind: "exact",
        confidence: "safe",
        invoiceIds: [exact[0].id],
        reason: "Jedinečný VS, měna a přesná zbývající částka.",
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
