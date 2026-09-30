import { isValidCzSkIco } from "@/lib/invoice-ocr";

// Klient registru ARES (Ministerstvo financí). Slouží jako nezávislý zdroj
// názvu a DIČ odběratele podle IČO. Výpadek ARES nikdy nesmí zablokovat
// vytěžení faktury: vrací "unavailable" a volající to ukáže jako varování.

export type AresSubject = { ico: string; name: string; dic: string | null; address: string | null };

export type AresLookup =
  | { status: "found"; subject: AresSubject; cached: boolean }
  | { status: "not_found" }
  | { status: "invalid_ico" }
  | { status: "unavailable"; reason: "timeout" | "http_error" | "network" | "invalid_response" };

const ARES_URL = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/";
const DEFAULT_TIMEOUT_MS = 3_000;
const FOUND_TTL_MS = 24 * 60 * 60_000;
const NOT_FOUND_TTL_MS = 60 * 60_000;
const MAX_CACHE_ENTRIES = 500;

type CacheEntry = { expires: number; result: Extract<AresLookup, { status: "found" | "not_found" }> };
const cache = new Map<string, CacheEntry>();

export function clearAresCache() {
  cache.clear();
}

export async function lookupAresSubject(
  rawIco: string,
  { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, now = Date.now }: {
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
    timeoutMs?: number;
    now?: () => number;
  } = {},
): Promise<AresLookup> {
  const ico = rawIco.replace(/\D/g, "");
  if (!isValidCzSkIco(ico)) return { status: "invalid_ico" };

  const hit = cache.get(ico);
  if (hit && hit.expires > now()) return hit.result.status === "found" ? { ...hit.result, cached: true } : hit.result;
  if (hit) cache.delete(ico);

  const remember = (result: CacheEntry["result"], ttl: number) => {
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(ico, { expires: now() + ttl, result });
    return result;
  };

  let response: Response;
  try {
    response = await fetchImpl(`${ARES_URL}${ico}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "";
    return { status: "unavailable", reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
  if (response.status === 404) return remember({ status: "not_found" }, NOT_FOUND_TTL_MS);
  if (!response.ok) return { status: "unavailable", reason: "http_error" };

  const payload = await response.json().catch(() => null) as {
    ico?: unknown; obchodniJmeno?: unknown; dic?: unknown; sidlo?: { textovaAdresa?: unknown } | null;
  } | null;
  const name = typeof payload?.obchodniJmeno === "string" ? payload.obchodniJmeno.trim().slice(0, 240) : "";
  // Odpověď k jinému IČO nebo bez názvu je chyba přenosu, ne údaj o subjektu.
  if (!payload || !name || (typeof payload.ico === "string" && payload.ico.replace(/\D/g, "") !== ico)) {
    return { status: "unavailable", reason: "invalid_response" };
  }
  const dic = typeof payload.dic === "string" && /^CZ\d{8,10}$/i.test(payload.dic.trim()) ? payload.dic.trim().toUpperCase() : null;
  const address = typeof payload.sidlo?.textovaAdresa === "string" ? payload.sidlo.textovaAdresa.trim().slice(0, 300) : null;
  const found = remember({ status: "found", cached: false, subject: { ico, name, dic, address } }, FOUND_TTL_MS);
  return found;
}
