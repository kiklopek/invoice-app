import { normalizeSearchText } from "./text-search";

export const CUSTOMER_SEARCH_MIN_LENGTH = 2;

/** RPC parameters are literal values, never PostgREST filter expressions. */
export function parseCustomerSearchQuery(raw: string | null | undefined):
  { valid: true; query: string | null } | { valid: false } {
  const query = (raw ?? "").trim();
  if (query.length > 100 || /[\u0000-\u001f\u007f]/.test(query)) return { valid: false };
  return { valid: true, query: normalizeSearchText(query).length < CUSTOMER_SEARCH_MIN_LENGTH ? null : query };
}

// Compatibility while the search RPC migration awaits deployment. PostgREST
// filter syntax must only receive allowlisted, escaped input.
export function legacyCustomerSearchFilter(raw: string): string | null {
  const safe = raw.trim().slice(0, 100).replace(/[^\p{L}\p{N} @+._-]/gu, " ").replace(/\s+/g, " ").trim();
  if (safe.length < CUSTOMER_SEARCH_MIN_LENGTH) return null;
  const literal = safe.replace(/[_\\]/g, (match) => `\\${match}`);
  return ["name", "ico", "email", "phone"].map((column) => `${column}.ilike.%${literal}%`).join(",");
}
