import "server-only";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "./locales";

export { getDictionary } from "./dictionaries";

/**
 * Jazyk přihlašovacích stránek pro aktuální požadavek: volba z přepínače na
 * landing page, jinak čeština. Landing sama tohle nevolá (čtení cookies by z
 * ní udělalo dynamickou stránku); má pevnou `/` (cs) a `/en`.
 */
export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);
}
