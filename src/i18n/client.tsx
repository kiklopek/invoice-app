"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { dictionaries, type Dictionary } from "./dictionaries";
import { DEFAULT_LOCALE, type Locale } from "./locales";

type I18n = { locale: Locale; t: Dictionary };

// Bez provideru (komponenta použitá mimo veřejnou část) platí čeština.
const I18nContext = createContext<I18n>({ locale: DEFAULT_LOCALE, t: dictionaries[DEFAULT_LOCALE] });

// Slovníky se importují tady, ne posílají ze serveru: obsahují funkce
// (texty s proměnnými), které přes hranici server/klient projít nejdou.
// Obal s lang říká čtečkám a prohlížeči, v jakém jazyce obsah je; kořenový
// <html lang="cs"> platí pro zbytek aplikace, která zůstává česky.
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: dictionaries[locale] }), [locale]);
  return (
    <I18nContext value={value}>
      <div lang={locale} style={{ display: "contents" }}>{children}</div>
    </I18nContext>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
