import type { Metadata } from "next";
import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n/client";
import { getDictionary, getLocale } from "@/i18n/server";

// Přihlášení, registrace a obnova hesla jdou přepnout CZ/EN (přepínač
// v AuthShell). Aplikace po přihlášení zůstává česky.
export async function generateMetadata(): Promise<Metadata> {
  const { meta } = getDictionary(await getLocale());
  return { title: meta.authTitle };
}

export default async function AuthLayout({ children }: { children: ReactNode }) {
  return <I18nProvider locale={await getLocale()}>{children}</I18nProvider>;
}
