import { normalizeVariableSymbol } from "./payment-import";
import { minorUnits } from "./money";
import { exactCombinations, type MatchableInvoice, type MatchProposal } from "./payment-matching";

/**
 * One payment pays one invoice.
 *
 * The row-by-row matcher (proposePaymentMatch) answers "which invoice could
 * THIS payment pay?" in isolation. That question can't express the constraint
 * the user actually needs -- that across the whole statement each payment is
 * used at most once and each invoice is paid at most once. Two payments of the
 * same amount would each independently "match" the same invoice and both look
 * safe. So the decision is made here, over the whole statement at once, and the
 * row-by-row matcher is left as the fallback for everything this pass declines
 * to decide (partial payments, one payment covering several invoices).
 */

export interface AssignablePayment {
  /** Stable key for this statement row -- the fingerprint in the import route. */
  key: string;
  amount: number;
  currency: string;
  variable_symbol?: string | null;
  counterparty_name?: string | null;
  counterparty_account?: string | null;
  /** undefined/null/true => trusted; explicit false => the account number
   * failed its checksum on decode (see gpc-parser.ts readAccount) and must
   * never be treated as a confirmed account for the "account" evidence tier
   * or for detecting an account-confirmed-for-two-counterparties conflict. */
  counterparty_account_verified?: boolean | null;
  booked_on?: string | null;
  /** Free-text payment message, where a payer may have written the invoice number. */
  note?: string | null;
}

/**
 * The version of the rules below, recorded on every entry this pass judges.
 * Unattended booking only ever acts on a proposal produced by the version the
 * database reconciler was written against, so a rule change can never silently
 * commit previews that an older, differently-reasoning engine had prepared.
 */
export const MATCHING_ENGINE_VERSION = "v5";

/**
 * Evidence is deliberately categorical, not a weighted score. A score lets a
 * pile of weak signals cross a threshold and auto-book money on nothing but
 * coincidence; naming the evidence means every automatic decision can be
 * explained by which facts were true, and the rules below can require the
 * specific combinations that are actually safe.
 */
type Evidence = {
  /** Payment VS equals the invoice's VS, or its (numeric) invoice number. */
  identifier: boolean;
  /** The invoice number appears as a whole token in the payment message. */
  reference: boolean;
  /** Payment is exactly the invoice's remaining amount, to the haler. */
  amount: boolean;
  /** Payer's account is already confirmed as belonging to this counterparty. */
  account: boolean;
  /** Payer's name matches the counterparty (banks truncate, so prefix-wise). */
  name: boolean;
  /** Payment is not dated before the invoice was issued. */
  time: boolean;
};

type Tier = {
  id: string;
  confidence: "safe" | "review";
  reason: string;
  holds: (evidence: Evidence) => boolean;
};

/** Strongest first. A payment is judged at the best tier it reaches at all. */
const TIERS: Tier[] = [
  {
    id: "identifier",
    confidence: "safe",
    reason: "Jedinečná shoda VS nebo čísla faktury a přesné zbývající částky.",
    holds: (evidence) => evidence.identifier && evidence.amount,
  },
  {
    id: "reference",
    confidence: "safe",
    reason:
      "Číslo faktury je uvedené ve zprávě pro příjemce a částka přesně odpovídá.",
    holds: (evidence) => evidence.reference && evidence.amount,
  },
  {
    id: "account",
    confidence: "safe",
    reason:
      "Účet plátce je potvrzeně spojený s tímto odběratelem a částka přesně odpovídá.",
    holds: (evidence) => evidence.account && evidence.amount && evidence.time,
  },
  // Books on the payer's NAME plus the exact amount, at the owner's explicit
  // instruction. This tier is weaker than the three above it in kind, not just
  // in degree: a name is text the payer's bank passed along, not a reference to
  // any invoice, so what it establishes is "this customer sent exactly this
  // much", never "this customer is paying THIS invoice". It books the right
  // invoice whenever the amount belongs to only one open invoice of theirs --
  // and the wrong one when the payment was really for something not yet in the
  // ledger. Every booking it makes therefore says so on the payment itself.
  {
    id: "name",
    confidence: "safe",
    reason:
      "Automaticky podle jména plátce a přesné částky — platba neuvedla použitelný variabilní symbol. Ověřte, pokud odběratel platí i faktury, které zatím nejsou v systému.",
    holds: (evidence) => evidence.name && evidence.amount && evidence.time,
  },
  {
    id: "amount",
    confidence: "review",
    reason:
      "Jediná otevřená faktura s přesně touto částkou; potvrďte přiřazení.",
    holds: (evidence) => evidence.amount && evidence.time,
  },
];

const cents = minorUnits;
const remaining = (invoice: MatchableInvoice) =>
  cents(invoice.amount) - cents(invoice.paid_amount);

/**
 * Shortest agreeing prefix that may stand as a name match. Raised from 6 when
 * the name tier started booking money on its own: at 6 characters a surname and
 * an initial agree with half a ledger of private individuals, which is tolerable
 * for ranking a human's choices and not for an unattended booking.
 */
const MINIMUM_NAME_LENGTH = 8;

/**
 * Bank statements truncate the payer's name (GPC gives 20 bytes -- "ESTIMATIC
 * SYSTEMS S." for "ESTIMATIC Systems s.r.o."), so this compares the shorter
 * normalized name as a prefix of the longer.
 */
function normalizeName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Prefix agreement on names that are ALREADY normalized. Split out so the
 * combination pass can normalize the whole open ledger once instead of
 * re-normalizing both sides for every payment/invoice pair it considers.
 */
function prefixAgrees(payer: string, counterparty: string) {
  const shared = Math.min(payer.length, counterparty.length);
  if (shared < MINIMUM_NAME_LENGTH) return false;
  return payer.slice(0, shared) === counterparty.slice(0, shared);
}

function namesMatch(paymentName: string | null | undefined, invoiceName: string) {
  return prefixAgrees(normalizeName(paymentName), normalizeName(invoiceName));
}

function matchesIdentifier(invoice: MatchableInvoice, normalizedVs: string) {
  if (!normalizedVs) return false;
  const invoiceVs = normalizeVariableSymbol(invoice.variable_symbol);
  if (invoiceVs) return invoiceVs === normalizedVs;
  // No VS on the invoice at all (a template that never prints the field) --
  // payers then use the invoice number, which only works when it's numeric.
  return (
    /^\d+$/.test(invoice.invoice_number.trim()) &&
    normalizeVariableSymbol(invoice.invoice_number) === normalizedVs
  );
}

/**
 * Shortest invoice number that may be recognised inside a free-text message.
 * Below this a number is not distinctive enough to be worth acting on: "12"
 * occurs in ordinary payment text constantly, and a wrong hit here books money.
 */
const MINIMUM_REFERENCE_LENGTH = 4;

/**
 * Whether the payer wrote this invoice's number in the payment message.
 *
 * Boundary-aware on purpose: a plain substring search finds invoice "1234"
 * inside the document number "0915000000012345" and would book a payment onto a
 * completely unrelated invoice. A hit only counts when the number stands as a
 * whole token, with no alphanumeric character glued to either side.
 */
export function referencesInvoiceNumber(
  note: string | null | undefined,
  invoiceNumber: string,
) {
  const needle = invoiceNumber.trim().toUpperCase();
  const haystack = (note ?? "").toUpperCase();
  // Alphanumeric only: the database reconciler re-derives this same rule before
  // it books anything, and keeping both engines to a form that needs no regex
  // escaping is what keeps their two answers identical.
  if (!/^[0-9A-Z]+$/.test(needle) || needle.length < MINIMUM_REFERENCE_LENGTH || !haystack)
    return false;
  const glued = (character: string | undefined) =>
    character !== undefined && /[0-9A-Z]/.test(character);
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    if (!glued(haystack[at - 1]) && !glued(haystack[at + needle.length]))
      return true;
  }
  return false;
}

function gatherEvidence(
  payment: AssignablePayment,
  invoice: MatchableInvoice,
  confirmedIcos: string[],
): Evidence {
  return {
    identifier: matchesIdentifier(
      invoice,
      normalizeVariableSymbol(payment.variable_symbol),
    ),
    reference: referencesInvoiceNumber(payment.note, invoice.invoice_number),
    amount: remaining(invoice) === cents(payment.amount),
    account: Boolean(
      invoice.counterparty_ico && confirmedIcos.includes(invoice.counterparty_ico),
    ),
    name: namesMatch(payment.counterparty_name, invoice.counterparty_name),
    // Missing dates are a gap in the data, not evidence of a problem -- this
    // guard only exists to reject a payment that provably predates the invoice.
    time:
      !payment.booked_on ||
      !invoice.issue_date ||
      payment.booked_on >= invoice.issue_date,
  };
}

export type StatementAssignment = {
  proposal: MatchProposal;
  /** Which tier decided it -- for tests and for explaining the decision. */
  tier: string | null;
};

/**
 * Decides the whole statement at once. Returns a proposal per payment key;
 * payments this pass declines to judge are simply absent, so the caller can
 * fall back to the row-by-row matcher for them.
 */
export function assignStatementPayments(
  payments: AssignablePayment[],
  invoices: MatchableInvoice[],
  confirmedIcosByAccount: Map<string, string[]> = new Map(),
  /**
   * Invoices already settled. They are never a match target -- they exist here
   * only so a payment quoting one of them can be reported as such instead of
   * silently becoming "no match", which is what hid duplicate payments.
   */
  settledInvoices: MatchableInvoice[] = [],
): Map<string, StatementAssignment> {
  const open = invoices.filter((invoice) => remaining(invoice) > 0);
  // Every tier requires the exact remaining amount, so the candidate set for a
  // payment is just the invoices that cost exactly what was paid. Without this
  // index the pass would be payments x invoices, which on a large ledger is
  // millions of pointless comparisons.
  const byRemaining = new Map<string, MatchableInvoice[]>();
  const byIdentifier = new Map<string, MatchableInvoice[]>();
  const byReference = new Map<string, MatchableInvoice[]>();
  const settledByIdentifier = new Map<string, MatchableInvoice[]>();
  const append = (index: Map<string, MatchableInvoice[]>, key: string, invoice: MatchableInvoice) => {
    const bucket = index.get(key);
    if (bucket) bucket.push(invoice);
    else index.set(key, [invoice]);
  };
  const identifierKey = (invoice: MatchableInvoice) => normalizeVariableSymbol(invoice.variable_symbol) ||
    (/^\d+$/.test(invoice.invoice_number.trim()) ? normalizeVariableSymbol(invoice.invoice_number) : "");
  for (const invoice of open) {
    const key = `${invoice.currency}:${remaining(invoice)}`;
    append(byRemaining, key, invoice);
    if (identifierKey(invoice)) append(byIdentifier, `${invoice.currency}:${identifierKey(invoice)}`, invoice);
    if (/^[0-9A-Z]{4,}$/.test(invoice.invoice_number.trim().toUpperCase()))
      append(byReference, `${invoice.currency}:${invoice.invoice_number.trim().toUpperCase()}`, invoice);
  }
  for (const invoice of settledInvoices)
    if (identifierKey(invoice)) append(settledByIdentifier, `${invoice.currency}:${identifierKey(invoice)}`, invoice);

  const results = new Map<string, StatementAssignment>();
  const takenInvoices = new Set<string>();
  const decidedPayments = new Set<string>();

  const stop = (
    payment: AssignablePayment,
    tier: string,
    invoiceIds: string[],
    reason: string,
  ) => {
    decidedPayments.add(payment.key);
    results.set(payment.key, {
      tier,
      proposal: { kind: "ambiguous", confidence: "review", invoiceIds, reason },
    });
  };

  // Everything the tiers below can decide rests on ONE identifier being true.
  // This pass runs first and looks at the identifiers alone, ignoring amounts,
  // because the situations it catches are precisely the ones where an amount
  // that happens to line up would otherwise manufacture false confidence: two
  // invoices sharing a variable symbol, a message naming a different invoice
  // than the symbol does, or a symbol quoting an invoice that is already paid.
  // None of them may be resolved by picking whichever reading fits the money.
  for (const payment of payments) {
    const normalizedVs = normalizeVariableSymbol(payment.variable_symbol);
    const identified = byIdentifier.get(`${payment.currency}:${normalizedVs}`) ?? [];
    const tokens = new Set((payment.note ?? "").toUpperCase().match(/[0-9A-Z]{4,}/g) ?? []);
    const referenced = [...tokens].flatMap(token => byReference.get(`${payment.currency}:${token}`) ?? []);
    const named = new Set([...identified, ...referenced].map((invoice) => invoice.id));

    if (identified.length > 0 && referenced.length > 0 && named.size > 1) {
      stop(payment, "conflict", [...named],
        "Variabilní symbol a zpráva pro příjemce ukazují na různé faktury — rozhodněte, která platí.");
      continue;
    }
    if (identified.length > 1) {
      // Two open invoices carrying the same symbol is a numbering problem, not
      // a matching problem. Resolving it by amount would paper over the cause.
      stop(payment, "identifier", identified.map((invoice) => invoice.id),
        "Stejný variabilní symbol nese více otevřených faktur — opravte číslování a přiřaďte ručně.");
      continue;
    }
    if (referenced.length > 1) {
      stop(payment, "reference", referenced.map((invoice) => invoice.id),
        "Zpráva pro příjemce uvádí více faktur. Rozdělení jedné platby mezi faktury zatím potvrzuje člověk.");
      continue;
    }
    const explicit = identified[0] ?? referenced[0];
    if (explicit && remaining(explicit) !== cents(payment.amount)) {
      stop(payment, "identifier", [explicit.id], "Platba odkazuje na fakturu s jiným zůstatkem. Potvrďte částečnou úhradu nebo přeplatek.");
      continue;
    }
    if (identified.length === 0 && referenced.length === 0 && normalizedVs) {
      const settled = settledByIdentifier.get(`${payment.currency}:${normalizedVs}`) ?? [];
      if (settled.length > 0)
        stop(payment, "settled", settled.map((invoice) => invoice.id),
          "Platba odkazuje na fakturu, která je už uhrazená. Ověřte, zda nejde o duplicitní platbu nebo zálohu.");
    }
  }

  type Pair = { payment: AssignablePayment; invoice: MatchableInvoice; tier: number };
  const pairs: Pair[] = [];
  for (const payment of payments) {
    if (decidedPayments.has(payment.key)) continue;
    // A bank account that has been confirmed for two different customers no
    // longer identifies either of them. It stays useful for ranking a human's
    // choices, but on its own it must not carry an unattended booking.
    // An account number whose checksum failed on decode (verified === false,
    // e.g. a GPC line that didn't pass the mod-11 check on either reading)
    // is worse than ambiguous -- it's not trustworthy at all, so it never
    // even reaches the account-evidence lookup, let alone the "account" tier.
    const confirmed = payment.counterparty_account_verified === false ? [] : [
      ...new Set(
        (confirmedIcosByAccount.get(payment.counterparty_account ?? "") ?? []).filter(Boolean),
      ),
    ];
    const confirmedIcos = confirmed.length === 1 ? confirmed : [];
    const candidates =
      byRemaining.get(`${payment.currency}:${cents(payment.amount)}`) ?? [];
    // Bound pathological equal-amount groups rather than building millions of pairs.
    // No truncated candidate set may produce an automatic booking.
    if (candidates.length > 250) {
      const identified = byIdentifier.get(`${payment.currency}:${normalizeVariableSymbol(payment.variable_symbol)}`) ?? [];
      if (identified.length !== 1 || remaining(identified[0]) !== cents(payment.amount)) {
        stop(payment, "complex", [], "Příliš mnoho faktur se stejnou částkou. Zpřesněte přiřazení ručně.");
        continue;
      }
    }
    const bounded = candidates.length > 250
      ? byIdentifier.get(`${payment.currency}:${normalizeVariableSymbol(payment.variable_symbol)}`) ?? [] : candidates;
    for (const invoice of bounded) {
      const evidence = gatherEvidence(payment, invoice, confirmedIcos);
      const conflict = confirmed.length > 0 && !confirmed.includes(invoice.counterparty_ico ?? "");
      const tier = conflict ? TIERS.length - 1 : TIERS.findIndex((candidate) => candidate.holds(evidence));
      if (tier >= 0) pairs.push({ payment, invoice, tier });
    }
  }

  for (let tier = 0; tier < TIERS.length; tier += 1) {
    const live = pairs.filter(
      (pair) =>
        pair.tier === tier &&
        !decidedPayments.has(pair.payment.key) &&
        !takenInvoices.has(pair.invoice.id),
    );
    const perPayment = new Map<string, Pair[]>();
    const perInvoice = new Map<string, Pair[]>();
    for (const pair of live) {
      perPayment.set(pair.payment.key, [
        ...(perPayment.get(pair.payment.key) ?? []),
        pair,
      ]);
      perInvoice.set(pair.invoice.id, [
        ...(perInvoice.get(pair.invoice.id) ?? []),
        pair,
      ]);
    }
    // Accept a pair only when it is the single option in BOTH directions. One
    // payment with two candidate invoices is ambiguous for the obvious reason;
    // two payments competing for one invoice is just as ambiguous, and picking
    // by row order there would silently mark the wrong invoice paid.
    for (const pair of live) {
      const unique =
        (perPayment.get(pair.payment.key) ?? []).length === 1 &&
        (perInvoice.get(pair.invoice.id) ?? []).length === 1;
      if (!unique) continue;
      decidedPayments.add(pair.payment.key);
      takenInvoices.add(pair.invoice.id);
      results.set(pair.payment.key, {
        tier: TIERS[tier].id,
        proposal: {
          kind: "exact",
          confidence: TIERS[tier].confidence,
          invoiceIds: [pair.invoice.id],
          reason: TIERS[tier].reason,
        },
      });
    }
    // Everything still live at this tier was contested. It does not fall
    // through to a weaker tier: a contested strong match is a question for a
    // human, not a reason to go looking for a flimsier answer.
    for (const [key, contested] of perPayment) {
      if (decidedPayments.has(key)) continue;
      decidedPayments.add(key);
      results.set(key, {
        tier: TIERS[tier].id,
        proposal: {
          kind: "ambiguous",
          confidence: "review",
          invoiceIds: [
            ...new Set(contested.map((pair) => pair.invoice.id)),
          ],
          reason:
            (perPayment.get(key) ?? []).length > 1
              ? "Stejně silně odpovídá více faktur — vyberte správnou."
              : "O tuto fakturu se uchází více plateb z výpisu — zkontrolujte přiřazení.",
        },
      });
    }
  }

  // Last pass: one payment settling SEVERAL of the payer's invoices at once.
  //
  // Everything above needed the payment to equal one invoice exactly. A customer
  // who pays three invoices in a single transfer matches none of it, and used to
  // fall out as "no match". Here the payer's name picks the customer and a
  // subset-sum over their open invoices looks for a set that adds up to the
  // payment to the haler.
  //
  // This is the weakest rule in the file and the only one that can mark several
  // invoices paid from one decision, so it books only when the ledger leaves no
  // choice: exactly one subset adds up. Two different subsets reaching the same
  // total means the statement does not say which invoices were paid, and picking
  // either would silently settle invoices the customer never meant to pay.
  const undecided = payments.filter((payment) => !decidedPayments.has(payment.key));
  if (undecided.length > 0) {
    const normalizedOpen = open.map((invoice) => ({
      invoice,
      name: normalizeName(invoice.counterparty_name),
    }));
    type Combination = { payment: AssignablePayment; group: MatchableInvoice[]; found: string[][] };
    const attempts: Combination[] = [];
    for (const payment of undecided) {
      const payer = normalizeName(payment.counterparty_name);
      if (payer.length < MINIMUM_NAME_LENGTH) continue;
      const group = normalizedOpen
        .filter(
          (entry) =>
            prefixAgrees(payer, entry.name) &&
            entry.invoice.currency === payment.currency &&
            !takenInvoices.has(entry.invoice.id) &&
            (!payment.booked_on ||
              !entry.invoice.issue_date ||
              payment.booked_on >= entry.invoice.issue_date),
        )
        .map((entry) => entry.invoice);
      if (group.length === 0) continue;
      attempts.push({
        payment,
        group,
        found: exactCombinations(group, cents(payment.amount)).combinations,
      });
    }

    // A combination may only book when no other payment in this statement is
    // also claiming one of its invoices -- the same one-invoice-one-payment rule
    // the tiers above enforce, applied across whole sets.
    const claims = new Map<string, number>();
    for (const attempt of attempts)
      if (attempt.found.length === 1)
        for (const id of attempt.found[0])
          claims.set(id, (claims.get(id) ?? 0) + 1);

    for (const { payment, group, found } of attempts) {
      const byDueDate = [...group].sort(
        (a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "") || a.id.localeCompare(b.id),
      );
      const contested =
        found.length === 1 && found[0].some((id) => (claims.get(id) ?? 0) > 1);
      if (found.length === 1 && !contested) {
        for (const id of found[0]) takenInvoices.add(id);
        decidedPayments.add(payment.key);
        results.set(payment.key, {
          tier: "name_combination",
          proposal: {
            kind: "combination",
            confidence: "safe",
            invoiceIds: found[0],
            reason: `Automaticky podle jména plátce: platba přesně pokrývá ${found[0].length} otevřených faktur tohoto odběratele. Platba neuvedla použitelný variabilní symbol.`,
          },
        });
        continue;
      }
      decidedPayments.add(payment.key);
      results.set(payment.key, {
        tier: "name_combination",
        proposal: {
          kind: found.length > 1 || contested ? "ambiguous" : "manual",
          confidence: "review",
          invoiceIds: byDueDate.map((invoice) => invoice.id),
          reason:
            found.length > 1
              ? "Jméno plátce sedí, ale částku dává dohromady více různých kombinací faktur — vyberte správnou."
              : contested
                ? "O faktury v této kombinaci se uchází více plateb z výpisu — zkontrolujte přiřazení."
                : "Jméno plátce sedí, ale částka neodpovídá žádné faktuře ani součtu faktur tohoto odběratele. Může jít o zálohu, částečnou úhradu nebo přeplatek.",
        },
      });
    }
  }

  return results;
}
