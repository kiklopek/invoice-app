import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getDictionary, getLocale } from "@/i18n/server";

// Tab and search title of this sign-in page (the page may be a client component).
export async function generateMetadata(): Promise<Metadata> {
  return { title: getDictionary(await getLocale()).meta.registerTitle };
}

export default function RegisterLayout({ children }: { children: ReactNode }) {
  return children;
}
