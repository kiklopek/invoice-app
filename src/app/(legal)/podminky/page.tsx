import type { Metadata } from "next";
import { LegalPage } from "../legal-page";
import { TRIAL_DAYS, TRIAL_INVOICE_LIMIT } from "@/lib/plans";

export const metadata: Metadata = { title: "Podmínky používání | Splatno" };

export default function TermsPage() {
  return (
    <LegalPage title="Podmínky používání služby Splatno" updated="9. 10. 2026">
      <h2>1. Služba</h2>
      <p>Splatno je webová aplikace pro evidenci vydaných faktur, párování přijatých plateb a odesílání upomínek odběratelům. Službu provozuje provozovatel uvedený v záhlaví těchto podmínek.</p>
      <h2>2. Účet a firma</h2>
      <p>Účet zakládá zakladatel firmy, který se tím stává jejím administrátorem. Administrátor zve další uživatele a určuje jejich role. Za správnost údajů o firmě, fakturách a odběratelích odpovídá firma.</p>
      <h2>3. Zabezpečení</h2>
      <p>Přihlášení je chráněno heslem a jednorázovým kódem zaslaným e-mailem. Uživatel nesmí přístupové údaje sdílet a bez odkladu oznámí jejich zneužití.</p>
      <h2>4. Upomínky a e-maily</h2>
      <p>Automatické upomínky odesílá Splatno jménem firmy až poté, co je firma sama zapne. Firma odpovídá za to, že má k odeslání upomínky právní důvod.</p>
      <h2>5. Zkušební období a cena</h2>
      <p>Nová firma zadá při založení platební kartu. Prvních {TRIAL_DAYS} dní používá Splatno zdarma, nejvýš však pro {TRIAL_INVOICE_LIMIT} faktur. Zkušební období má každá firma (IČO) i každá platební karta jen jednou.</p>
      <p>Po skončení zkušebního období se z karty automaticky strhává cena zvoleného tarifu na začátku každého období (měsíc nebo rok). Ceny podle ceníku jsou uvedeny bez DPH. Platby zpracovává Stripe; provozovatel údaje o kartě nevidí ani neukládá.</p>
      <p>Vyšší tarif platí ihned a doplácí se poměrná část do konce období. Nižší tarif nebo měsíční platba platí od dalšího období a zaplacená částka se nevrací. Předplatné lze zrušit kdykoli s účinností ke konci zaplaceného období.</p>
      <p>Pokud se platbu nepodaří strhnout ani po opakovaných pokusech, nebo předplatné skončí, data firmy zůstávají zachována, ale přidávání nových faktur a odesílání automatických upomínek se pozastaví až do obnovení předplatného.</p>
      <h2>6. Ukončení</h2>
      <p>Firma může používání kdykoli ukončit. Na vyžádání jí provozovatel předá export jejích dat.</p>
    </LegalPage>
  );
}
