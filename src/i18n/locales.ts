// Jazyky veřejné části (landing a přihlášení). Volba se drží v cookie, adresy
// stránek se nemění; bez cookie rozhodne jazyk prohlížeče. Aplikace po
// přihlášení zůstává česky.

export const LOCALES = ["cs", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "cs";
export const LOCALE_COOKIE = "splatno-lang";
/** Jak dlouho si prohlížeč volbu pamatuje (1 rok). */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Jazyk z hlavičky Accept-Language podle vah q; jen podporované jazyky. */
function fromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split("-")[0], weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.lang && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  return ranked.map((entry) => entry.lang).find(isLocale) ?? null;
}

/** Uložená volba (cookie) > jazyk prohlížeče > čeština. */
export function resolveLocale(cookieValue: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  return fromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
