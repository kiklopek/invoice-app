import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Podmínky používání | Splatno" };

export default function TermsPage() {
  return (
    <LegalPage title="Podmínky používání služby Splatno" updated="7. 10. 2026">
      <h2>1. Služba</h2>
      <p>Splatno je webová aplikace pro evidenci vydaných faktur, párování přijatých plateb a odesílání upomínek odběratelům. Službu provozuje provozovatel uvedený v záhlaví těchto podmínek.</p>
      <h2>2. Účet a firma</h2>
      <p>Účet zakládá zakladatel firmy, který se tím stává jejím administrátorem. Administrátor zve další uživatele a určuje jejich role. Za správnost údajů o firmě, fakturách a odběratelích odpovídá firma.</p>
      <h2>3. Zabezpečení</h2>
      <p>Přihlášení je chráněno heslem a jednorázovým kódem zaslaným e-mailem. Uživatel nesmí přístupové údaje sdílet a bez odkladu oznámí jejich zneužití.</p>
      <h2>4. Upomínky a e-maily</h2>
      <p>Automatické upomínky odesílá Splatno jménem firmy až poté, co je firma sama zapne. Firma odpovídá za to, že má k odeslání upomínky právní důvod.</p>
      <h2>5. Zkušební období a cena</h2>
      <p>Podmínky zkušebního období a ceník budou doplněny před spuštěním placené verze.</p>
      <h2>6. Ukončení</h2>
      <p>Firma může používání kdykoli ukončit. Na vyžádání jí provozovatel předá export jejích dat.</p>
    </LegalPage>
  );
}
