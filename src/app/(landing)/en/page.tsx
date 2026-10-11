import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { en } from "@/i18n/dictionaries/en";

// Anglická landing page. Generuje se dopředu jako `/`; přepínač CZ | EN mezi
// nimi přechází a volbu uloží do cookie, aby ji převzalo přihlášení.
export const metadata: Metadata = {
  title: en.meta.landingTitle,
  description: en.meta.landingDescription,
  // openGraph se při slučování s kořenovým layoutem nahrazuje celý.
  openGraph: {
    siteName: "Splatno",
    title: en.meta.landingTitle,
    description: en.meta.landingDescription,
    locale: "en_GB",
    type: "website",
  },
};

export default function EnglishHome() {
  return <LandingPage locale="en" />;
}
