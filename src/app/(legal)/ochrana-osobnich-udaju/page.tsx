import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Ochrana osobních údajů | Splatno" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Zásady zpracování osobních údajů" updated="9. 10. 2026">
      <h2>1. Jaké údaje zpracováváme</h2>
      <p>Jméno, e-mail a přihlašovací údaje uživatelů; údaje o firmě; údaje z faktur a bankovních výpisů, které firma do aplikace nahraje, včetně kontaktů na odběratele.</p>
      <h2>2. Proč</h2>
      <p>Abychom mohli poskytovat službu: přihlášení, evidenci faktur, párování plateb a odesílání upomínek. Pro údaje odběratelů je provozovatel zpracovatelem a firma správcem.</p>
      <h2>3. Komu údaje předáváme</h2>
      <p>Poskytovatelům infrastruktury (hosting, databáze, odesílání e-mailů), kteří je zpracovávají jen podle našich pokynů. Platby za předplatné zpracovává Stripe; údaje o kartě získává přímo Stripe a provozovatel je nevidí. Údaje neprodáváme.</p>
      <h2>3a. Ochrana zkušebního období</h2>
      <p>Aby zkušební období nešlo opakovaně zneužít, evidujeme IČO firmy, otisk platební karty od Stripe (nejde z něj zjistit číslo karty) a jednosměrný otisk IP adresy, ze které bylo zkušební období zahájeno. Otisk IP adresy mažeme po 90 dnech.</p>
      <h2>4. Jak dlouho</h2>
      <p>Po dobu používání služby a poté jen po dobu, kterou vyžadují právní předpisy (např. účetní doklady).</p>
      <h2>5. Vaše práva</h2>
      <p>Máte právo na přístup, opravu, výmaz, omezení zpracování, přenositelnost a vznesení námitky, a také právo podat stížnost u Úřadu pro ochranu osobních údajů.</p>
    </LegalPage>
  );
}
