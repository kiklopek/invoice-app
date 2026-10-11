"use client";

import { useEffect, useState } from "react";
import { entryFromSearch, type EntryBrand } from "@/lib/tenant-entries";

export { withEntry, type EntryBrand } from "@/lib/tenant-entries";

// Přihlášení všech firem je na jedné adrese splatno.cz/login: firmu určuje
// účet, ne adresa. /hlavica zůstává jen jako starší adresa s logem R. Hlavica
// (staré záložky), aplikace na ni sama nikoho neposílá.

export const LOGIN_PATH = "/login";
const LEGACY_ENTRY_KEY = "splatno:login-entry";

/** Kam po odhlášení. Smaže i dřívější zapamatovaný vstup /hlavica. */
export function loginEntryPath() {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(LEGACY_ENTRY_KEY);
  } catch {
    // Bez úložiště není co mazat.
  }
  return LOGIN_PATH;
}

/**
 * Vzhled navazujících stránek (2FA, zapomenuté a nové heslo) podle vstupu,
 * ze kterého člověk přišel. Rozhoduje jen ?vstup=hlavica v adrese, ne
 * paměť prohlížeče: obecné stránky tak nikdy neukážou nic z R. Hlavica,
 * i když stejný prohlížeč dřív použil /hlavica. Jen vzhled -- přístup
 * řídí výhradně členství ve firmě.
 */
export function useEntryBrand(): EntryBrand {
  const [brand, setBrand] = useState<EntryBrand>("splatno");
  useEffect(() => {
    setBrand(entryFromSearch(new URLSearchParams(window.location.search)));
  }, []);
  return brand;
}

/** Přihlašovací stránka pro přesměrování v handlerech (2FA, nové heslo). */
export function currentEntryLoginPath() {
  return LOGIN_PATH;
}
