// Hledani zakazniku se sklada do PostgREST `or()` retezce:
//   name.ilike.%X%,ico.ilike.%X%,email.ilike.%X%,phone.ilike.%X%
//
// V tom jazyce jsou carka, tecka a zavorky RIDICI znaky. Kdyz se do X dostanou
// primo, muze dotaz rozsirit o dalsi podminku a filtrovat podle sloupcu, ktere
// v selectu vubec nejsou (napr. `notes`), nebo dotaz shodit na 500.
//
// Reseni je ALLOWLIST, ne blacklist: blacklist na tenhle jazyk jde vzdycky
// obejit, protoze ridicich znaku je vic, nez cloveka napadne.
//
// Povoleno je jen to, co se realne vyskytuje v ceskych jmenech firem, ICO,
// e-mailech a telefonech: pismena (vcetne diakritiky), cislice, mezera,
// pomlcka, zavinac, tecka, plus a podtrzitko.
//
// Podtrzitko je soucasti e-mailovych adres, takze projde -- ale je to
// zastupny znak LIKE, takze se nize escapuje. Procento naopak ve jmenech
// ani ICO smysl nedava a allowlist ho zahodi uplne; samotne "%" by jinak
// vratilo vsechny zakaznicky organizace.
const ALLOWED = /[^\p{L}\p{N} @+._-]/gu;
const MAX_LENGTH = 100;

export const CUSTOMER_SEARCH_MIN_LENGTH = 2;

/**
 * Vrati bezpecny vyraz pro `ilike`, nebo null, kdyz z nej po ocisteni
 * nezbylo dost na smysluplne hledani.
 */
export function sanitizeCustomerSearch(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Nejdriv ridici znaky PostgREST, pak teprve zastupne znaky LIKE.
  const allowed = raw.trim().slice(0, MAX_LENGTH).replace(ALLOWED, " ").replace(/\s+/g, " ").trim();
  if (allowed.length < CUSTOMER_SEARCH_MIN_LENGTH) return null;

  // Podtrzitko projde allowlistem (e-maily), ale v LIKE znamena "libovolny
  // znak" -- bez escapovani by "a_b" naslo i "axb". Procento sem uz nedojde,
  // allowlist ho zahodil.
  return allowed.replace(/[_\\]/g, match => `\\${match}`);
}

/** Sestavi `or()` filtr. Ocekava uz ocisteny vstup ze sanitizeCustomerSearch. */
export function customerSearchFilter(safe: string) {
  return ["name", "ico", "email", "phone"].map(column => `${column}.ilike.%${safe}%`).join(",");
}
