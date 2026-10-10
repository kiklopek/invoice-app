import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { getDictionary, getLocale } from "@/i18n/server";

// splatno.cz: veřejná prezentace produktu. "/" není v matcheru proxy.ts, takže
// ji vidí i nepřihlášený návštěvník. Jazyk (CZ/EN) volí přepínač v hlavičce.
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const { meta } = getDictionary(locale);
  return {
    title: meta.landingTitle,
    description: meta.landingDescription,
    // openGraph se při slučování s layoutem nahrazuje celý, proto všechna pole.
    openGraph: {
      siteName: "Splatno",
      title: meta.landingTitle,
      description: meta.landingDescription,
      locale: locale === "en" ? "en_GB" : "cs_CZ",
      type: "website",
    },
  };
}

export default function Home() {
  return <LandingPage />;
}
