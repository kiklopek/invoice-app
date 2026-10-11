import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { cs } from "@/i18n/dictionaries/cs";

// splatno.cz: veřejná prezentace produktu. "/" není v matcheru proxy.ts, takže
// ji vidí i nepřihlášený návštěvník. Česká verze; anglická je na /en. Obě se
// generují dopředu (nic nečtou z požadavku) -- viz src/lib/landing-static.test.ts.
export const metadata: Metadata = {
  title: cs.meta.landingTitle,
  description: cs.meta.landingDescription,
};

export default function Home() {
  return <LandingPage locale="cs" />;
}
