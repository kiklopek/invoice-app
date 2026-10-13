import { LandingPage } from "@/components/landing/landing-page";
import { landingMetadata } from "@/lib/seo";

// Anglická landing page. Generuje se dopředu jako `/`; přepínač CZ | EN mezi
// nimi přechází a volbu uloží do cookie, aby ji převzalo přihlášení.
export const metadata = landingMetadata("en");

export default function EnglishHome() {
  return <LandingPage locale="en" />;
}
