// Kdy po požadavku zahodit zapamatované stránky v prohlížeči.
//
// Prohlížeč si teď pamatuje navštívené stránky (next.config.js,
// experimental.staleTimes), takže přepnutí zpět je okamžité. Cenou je
// riziko, že se po změně (úhrada, smazání faktury, nastavení) ukáže stránka
// se starými čísly. Proto se po každé úspěšné změně dat přes naše API celá
// paměť zahodí (router.refresh() v RouterCacheInvalidator).
//
// Změna dat = požadavek na vlastní /api/* jiný než GET/HEAD, který prošel.
// Neúspěšný požadavek nic nezměnil, cizí doména taky ne.
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isDataMutation(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  response: Pick<Response, "ok">,
  origin: string,
) {
  if (!response.ok) return false;
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  if (READ_METHODS.has(method)) return false;
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return false;
  }
  // Přihlášení a odhlášení končí přechodem na jinou stránku; obnovovat
  // stávající by byla jen práce navíc.
  return url.origin === origin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/");
}
