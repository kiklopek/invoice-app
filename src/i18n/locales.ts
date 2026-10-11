// Jazyky veřejné části (landing a přihlášení). Výchozí je vždy čeština;
// angličtinu si návštěvník zvolí přepínačem na landing page. Volba se drží
// v cookie, adresy stránek se nemění a přihlášení ji jen převezme.
// Aplikace po přihlášení zůstává česky.

export const LOCALES = ["cs", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "cs";
export const LOCALE_COOKIE = "splatno-lang";
/** Jak dlouho si prohlížeč volbu pamatuje (1 rok). */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Uložená volba z přepínače, jinak čeština (jazyk prohlížeče se neřeší). */
export function resolveLocale(cookieValue: string | null | undefined): Locale {
  return isLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;
}
