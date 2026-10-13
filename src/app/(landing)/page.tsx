import { LandingPage } from "@/components/landing/landing-page";
import { landingMetadata } from "@/lib/seo";

// splatno.cz: veřejná prezentace produktu. "/" není v matcheru proxy.ts, takže
// ji vidí i nepřihlášený návštěvník. Česká verze; anglická je na /en. Obě se
// generují dopředu (nic nečtou z požadavku) -- viz src/lib/landing-static.test.ts.
export const metadata = landingMetadata("cs");

export default function Home() {
  return <LandingPage locale="cs" />;
}
