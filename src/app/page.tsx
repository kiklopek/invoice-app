import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";

// splatno.cz: veřejná prezentace produktu. "/" není v matcheru proxy.ts, takže
// ji vidí i nepřihlášený návštěvník.
export const metadata: Metadata = {
  title: "Splatno | Faktury pod kontrolou. Od vystavení až po úhradu.",
  description:
    "Splatno hlídá splatnosti, páruje platby a posílá upomínky. Vy řešíte jen to, co opravdu potřebuje vaši pozornost.",
};

export default function Home() {
  return <LandingPage />;
}
