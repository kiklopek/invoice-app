import { normalizeSearchText } from "./text-search";

export type SearchResultType = "invoice" | "customer" | "payment";
export type WorkspaceSearchResult = {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string;
  href: string;
};
export type WorkspaceSearchData = {
  results: WorkspaceSearchResult[];
  unavailable: SearchResultType[];
};

export const searchTypeLabels: Record<SearchResultType, string> = {
  invoice: "Faktura",
  customer: "Klient",
  payment: "Platba",
};

/** Only literal, bounded input reaches the database search functions. */
export function parseWorkspaceSearch(raw: string | null): string | null {
  const query = (raw ?? "").trim();
  return query.length <= 100 && !/[\u0000-\u001f\u007f]/.test(query)
    ? query
    : null;
}

export function parseSearchAmount(
  input: string,
): { amount: number; currency?: string } | null {
  const match = input
    .trim()
    .match(/^([\d\s\u00a0\u202f.,]+)\s*(Kč|CZK|EUR|USD|€)?$/iu);
  if (!match) return null;
  const raw = match[1].trim();
  if (
    /\s/u.test(raw) &&
    !/^\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?$/u.test(raw)
  )
    return null;
  const text = raw.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > Number.MAX_SAFE_INTEGER
  )
    return null;
  const currency = !match[2]
    ? undefined
    : /^(Kč|CZK)$/iu.test(match[2])
      ? "CZK"
      : match[2] === "€"
        ? "EUR"
        : match[2].toUpperCase();
  return { amount, ...(currency ? { currency } : {}) };
}

export function searchAmountHref(input: string): string | null {
  const value = parseSearchAmount(input);
  if (!value) return null;
  return `/invoices?${new URLSearchParams({ amount_min: String(value.amount), amount_max: String(value.amount), ...(value.currency ? { currency: value.currency } : {}) })}`;
}

/** Escape every regexp operator. Czech/Slovak accents match in either direction
 * without requiring a database migration or fetching an entire payment archive.
 */
export function paymentSearchPattern(term: string): string {
  const accents: Record<string, string> = {
    a: "aáä",
    c: "cč",
    d: "dď",
    e: "eéěë",
    i: "iíï",
    l: "lĺľ",
    n: "nň",
    o: "oóôö",
    r: "rřŕ",
    s: "sš",
    t: "tť",
    u: "uúůü",
    y: "yý",
    z: "zž",
  };
  return [...normalizeSearchText(term)]
    .map((char) =>
      accents[char]
        ? `[${accents[char]}]`
        : char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
}

/** Quoted PostgREST values prevent commas, quotes and parentheses from turning
 * a literal search term into a different filter expression.
 */
export function paymentSearchFilter(term: string): string {
  const value = `"${paymentSearchPattern(term).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return [
    "counterparty_name",
    "counterparty_account",
    "variable_symbol",
    "external_id",
    "currency",
    "note",
  ]
    .map((field) => `${field}.imatch.${value}`)
    .join(",");
}

export function validPaymentHighlight(raw: unknown): string | undefined {
  return typeof raw === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      raw,
    )
    ? raw
    : undefined;
}
