import type { Locale } from "./locales";

// Formátování čísel, korun a dat pro veřejnou část. Částky jsou vždy v Kč,
// v angličtině se jen píšou jako „CZK 1,340,000“.

const intlLocale: Record<Locale, string> = { cs: "cs-CZ", en: "en-GB" };

const numberFormats = new Map<Locale, Intl.NumberFormat>();
function numberFormat(locale: Locale) {
  let format = numberFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(intlLocale[locale], { maximumFractionDigits: 0 });
    numberFormats.set(locale, format);
  }
  return format;
}

export function formatNumber(locale: Locale, value: number) {
  return numberFormat(locale).format(value);
}

export function formatCzk(locale: Locale, value: number) {
  const amount = formatNumber(locale, value);
  return locale === "en" ? `CZK ${amount}` : `${amount} Kč`;
}

/**
 * Datum bez času: „12. 3. 2026“ / „12 Mar 2026“. Bere ISO datum i Date.
 * `short` vynechá rok tam, kde je málo místa (anglický měsíc slovem je delší).
 */
export function formatDate(locale: Locale, value: string | Date, { short = false } = {}) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (locale === "cs") return `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()}`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(short ? {} : { year: "numeric" }) }).format(date);
}
