import "server-only";
import { cookies, headers } from "next/headers";
import { dictionaries, type Dictionary } from "./dictionaries";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "./locales";

/** Jazyk veřejné části pro aktuální požadavek: cookie, jinak jazyk prohlížeče. */
export async function getLocale(): Promise<Locale> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerList.get("accept-language"));
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
