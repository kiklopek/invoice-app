"use client";

import { useEffect, useState } from "react";

// Odkud se člověk přihlásil: obecné /login, nebo vstup R. Hlavica /hlavica.
// Po odhlášení se vrátí tam, odkud přišel (P10). Je to jen pohodlí pro
// vzhled, ne bezpečnost -- proto stačí úložiště prohlížeče.

export type LoginEntry = "/login" | "/hlavica";
const KEY = "splatno:login-entry";

export function rememberLoginEntry(entry: LoginEntry) {
  try {
    window.localStorage.setItem(KEY, entry);
  } catch {
    // Bez úložiště se po odhlášení ukáže obecné přihlášení.
  }
}

export function loginEntryPath(): LoginEntry {
  try {
    return window.localStorage.getItem(KEY) === "/hlavica" ? "/hlavica" : "/login";
  } catch {
    return "/login";
  }
}

export type EntryBrand = "splatno" | "hlavica";

export const HLAVICA_ENTRY_QUERY = "vstup=hlavica";

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
    setBrand(new URLSearchParams(window.location.search).get("vstup") === "hlavica" ? "hlavica" : "splatno");
  }, []);
  return brand;
}

/** Přihlašovací stránka vstupu z aktuální adresy (pro přesměrování v handlerech). */
export function currentEntryLoginPath(): LoginEntry {
  return new URLSearchParams(window.location.search).get("vstup") === "hlavica" ? "/hlavica" : "/login";
}

/** Odkaz, který si nese vstup R. Hlavica dál (obecný vstup nic nepřidává). */
export function withEntry(path: string, brand: EntryBrand) {
  if (brand !== "hlavica") return path;
  return `${path}${path.includes("?") ? "&" : "?"}${HLAVICA_ENTRY_QUERY}`;
}
