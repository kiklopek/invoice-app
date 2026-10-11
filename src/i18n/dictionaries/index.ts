import type { Locale } from "../locales";
import { cs, type Dictionary } from "./cs";
import { en } from "./en";

export type { Dictionary };

export const dictionaries: Record<Locale, Dictionary> = { cs, en };

/** Slovník pro daný jazyk. Čistá funkce: landing ji volá bez čtení požadavku, takže zůstává statická. */
export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
