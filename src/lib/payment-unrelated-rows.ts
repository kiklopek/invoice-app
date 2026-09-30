// Řádky výpisu, které nesouvisí s fakturami.
//
// Příchozí platba bez faktury se při potvrzení importu zapíše do knihy plateb
// jako „nespárovaná“. U vratky od dodavatele (E.ON přeplatek) nebo převodu
// mezi vlastními účty (6 000 476,67 Kč) to znečistí přehled nespárovaných
// plateb penězi, které tam nepatří. Uživatel proto může řádek označit
// „Nesouvisí s fakturami“ a databáze ho při zaúčtování přeskočí
// (supabase/migrations/*_gpc_unrelated_rows.sql).
//
// Vlastní převod se tu jen NAVRHUJE: panel ho předvybere s viditelným
// důvodem, ale nic se nestane, dokud uživatel import sám nepotvrdí, a jedním
// kliknutím to jde vrátit. Chybně označený zákaznický řádek by znamenal
// neuhrazenou fakturu a upomínku člověku, který zaplatil -- proto jsou
// pravidla rozpoznání úmyslně přísná.

export const OWN_TRANSFER_LABEL = "Vlastní převod – nebude zapsán k fakturám";
export const UNRELATED_LABEL = "Nesouvisí s fakturami – nebude zapsáno jako platba";

export type OwnTransferContext = {
  organizationName?: string | null;
  /** Firemní účty z nastavení, účet z hlavičky výpisu a účty dřívějších výpisů. */
  ownAccounts: Array<string | null | undefined>;
};

export type OwnTransferMatch = { kind: "account" | "name"; reason: string };

type EntryForDetection = {
  disposition?: string | null;
  amount?: number | string | null;
  counterparty_name?: string | null;
  counterparty_account?: string | null;
  counterparty_account_verified?: boolean | null;
};

type CanonicalAccount = { prefix: string; number: string; bank: string | null };

const stripZeros = (value: string) => value.replace(/^0+/, "");

function ibanIsValid(iban: string) {
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const char of rearranged) {
    const code = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/**
 * Český účet v libovolném běžném zápisu: "123-5473460237/0100",
 * "5473460237", "000123-0005473460237/0100" nebo CZ IBAN. Vrací null pro
 * cokoli, co za účet s jistotou považovat nejde -- nehádá.
 */
function canonicalAccount(raw: string | null | undefined): CanonicalAccount | null {
  const value = (raw ?? "").replace(/\s/g, "").toUpperCase();
  if (!value) return null;
  const iban = /^CZ\d{22}$/.test(value) ? value : null;
  if (iban) {
    if (!ibanIsValid(iban)) return null;
    const number = stripZeros(iban.slice(14));
    return number ? { prefix: stripZeros(iban.slice(8, 14)), number, bank: iban.slice(4, 8) } : null;
  }
  const match = /^(?:(\d+)-)?(\d+)(?:\/(\d{4}))?$/.exec(value);
  if (!match) return null;
  const prefix = stripZeros(match[1] ?? "");
  const number = stripZeros(match[2]);
  if (!number || number.length > 10 || prefix.length > 6) return null;
  return { prefix, number, bank: match[3] ?? null };
}

function sameAccount(a: CanonicalAccount, b: CanonicalAccount) {
  // Kód banky porovnáváme, kdykoli ho znají obě strany: stejné číslo
  // v jiné bance je jiný účet.
  return a.prefix === b.prefix && a.number === b.number && (!a.bank || !b.bank || a.bank === b.bank);
}

function normalizeName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** GPC ukládá jméno partnera na 20 znaků; delší jména jsou useknutá. */
const GPC_NAME_WIDTH = 20;
const MINIMUM_TRUNCATED_NAME = 8;

export function detectOwnTransfer(entry: EntryForDetection, context: OwnTransferContext): OwnTransferMatch | null {
  if (entry.disposition != null && entry.disposition !== "accepted") return null;
  const amount = Number(entry.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  // Neověřené číslo účtu (neprošlo mod-11) není důkaz ničeho.
  const counterparty = entry.counterparty_account_verified === false ? null : canonicalAccount(entry.counterparty_account);
  if (counterparty) {
    for (const own of context.ownAccounts) {
      const candidate = canonicalAccount(own);
      if (candidate && sameAccount(counterparty, candidate))
        return {
          kind: "account",
          reason: `Protiúčet ${entry.counterparty_account} je vlastní účet organizace.`,
        };
    }
  }

  const payer = normalizeName(entry.counterparty_name);
  const organization = normalizeName(context.organizationName);
  if (payer && organization) {
    const rawLength = (entry.counterparty_name ?? "").trim().length;
    const truncated = rawLength >= GPC_NAME_WIDTH - 1 && payer.length >= MINIMUM_TRUNCATED_NAME;
    if (payer === organization || (truncated && organization.startsWith(payer)))
      return {
        kind: "name",
        reason: `Plátce „${(entry.counterparty_name ?? "").trim()}“ odpovídá názvu organizace.`,
      };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Panel: z rozhodnutí uživatele sestaví to, co jde na PATCH před potvrzením.
// ---------------------------------------------------------------------------

export type ReviewAllocation = { invoice_id: string; amount: number; is_manual_partial: boolean };

export function buildStatementReviewSubmission<E extends { id: string; line_number: number; fingerprint: string }>(params: {
  entries: E[];
  unrelated: Record<string, boolean | undefined>;
  allocationsFor: (entry: E) => ReviewAllocation[];
}):
  | {
      ok: true;
      reviewed_entry_ids: string[];
      unrelated_entry_ids: string[];
      allocations: Array<ReviewAllocation & { entry_id: string }>;
    }
  | { ok: false; line_number: number; error: string } {
  const unrelatedIds: string[] = [];
  const allocations: Array<ReviewAllocation & { entry_id: string }> = [];
  for (const entry of params.entries) {
    const rows = params.allocationsFor(entry);
    if (params.unrelated[entry.fingerprint]) {
      if (rows.length > 0)
        return {
          ok: false,
          line_number: entry.line_number,
          error: `Řádek ${entry.line_number} je označený „Nesouvisí s fakturami“, ale má vybrané faktury. Zrušte jedno, nebo druhé.`,
        };
      unrelatedIds.push(entry.id);
      continue;
    }
    for (const row of rows) allocations.push({ entry_id: entry.id, ...row });
  }
  return {
    ok: true,
    reviewed_entry_ids: params.entries.map((entry) => entry.id),
    unrelated_entry_ids: unrelatedIds,
    allocations,
  };
}

// ---------------------------------------------------------------------------
// API: validace a převod na JSON pro save_bank_statement_allocations.
// ---------------------------------------------------------------------------

export const UNRELATED_CONFLICT_ERROR =
  "Řádek označený „Nesouvisí s fakturami“ nemůže mít zároveň přiřazenou fakturu.";

export function buildReviewedEntriesPayload(input: {
  reviewed_entry_ids: unknown;
  unrelated_entry_ids: unknown;
  allocations: unknown;
}):
  | { ok: true; reviewed_entries: Array<string | { id: string; unrelated: boolean }> }
  | { ok: false; code: "invalid_unrelated_entries" | "unrelated_entry_has_allocations"; error: string } {
  const reviewed = Array.isArray(input.reviewed_entry_ids) ? (input.reviewed_entry_ids as unknown[]) : [];
  const rawUnrelated = input.unrelated_entry_ids ?? [];
  const invalid = {
    ok: false as const,
    code: "invalid_unrelated_entries" as const,
    error: "Neplatné označení řádků, které nesouvisí s fakturami.",
  };
  if (!Array.isArray(rawUnrelated) || rawUnrelated.some((id) => typeof id !== "string")) return invalid;
  const unrelated = new Set(rawUnrelated as string[]);
  if (unrelated.size !== rawUnrelated.length) return invalid;
  for (const id of unrelated) if (!reviewed.includes(id)) return invalid;

  const allocations = Array.isArray(input.allocations) ? (input.allocations as unknown[]) : [];
  if (
    allocations.some(
      (row) => row && typeof row === "object" && unrelated.has((row as { entry_id?: unknown }).entry_id as string),
    )
  )
    return { ok: false, code: "unrelated_entry_has_allocations", error: UNRELATED_CONFLICT_ERROR };

  // Bez označených řádků posíláme přesně původní tvar, takže nový server
  // funguje i proti databázi, na kterou ještě nedorazila nová migrace.
  if (unrelated.size === 0) return { ok: true, reviewed_entries: reviewed as string[] };
  return {
    ok: true,
    reviewed_entries: reviewed.map((id) => ({ id: id as string, unrelated: unrelated.has(id as string) })),
  };
}
