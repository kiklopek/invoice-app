# P00 — rozhodnutí a otevřené otázky

Stav k 17. 10. 2026. „Potvrzeno“ níže znamená vyplývající ze současného zadání nebo zdrojů; „návrh“ není souhlas uživatele.

| ID | Stav | Rozhodnutí / důvod |
| --- | --- | --- |
| D01 | Potvrzeno zadáním | P00 je pouze audit a dokumentace. Žádné opravy identifikovaných problémů ani přepis vzhledu. |
| D02 | Potvrzeno uživatelem | Pracovní větev `design-rebuild`; žádný přímý zásah, merge nebo push do `main`. |
| D03 | Vyřešeno | Master a phase template byly dodány. `00-master-plan.md` a `prompts/phase-template.md` jsou přesné kopie s evidovaným SHA-256. Původní stop pravidlo P00 zůstává. |
| D04 | Potvrzeno zdroji | Inventura vychází ze skutečných 28 stránek, ne z příkladů v historickém briefu. Route groups netvoří URL. API, výstupy a dialogy se evidují odděleně. |
| D05 | Potvrzeno zdroji | CS/EN veřejný web a existující auth překlady se zachovávají; nepřidávat neexistující jazykové varianty pracovních toků. |
| D06 | Potvrzeno zdroji | Registrace zakladatele a přijetí pozvánky jsou různé procesy. Obě identity se pak přihlašují běžným loginem. Samotná shoda domény nebo e-mailu není aktivní firemní členství. |
| D07 | Kontrakt k zachování | Server auth, login-session, OTP/MFA, returnTo, per-user onboarding draft a billing gate zůstávají v původních vrstvách. UI role není server autorizace. |
| D08 | Kontrakt k zachování | Revize, idempotence, účetní výpočty, potvrzení účtu bankovního výpisu, OCR důkazy a validační chyby nejsou vizuální detaily k vynechání. |
| D09 | Kontrakt k zachování | Dvě stránky upomínek/šablony používají společný nastavený datový kontrakt. Samostatné ukládání loga nemá přepsat textové koncepty. |
| D10 | Návrh | Nenahrazovat globální CSS ani všechny formuláře jedním velkým PR. Nejprve schválit komponentní a stavové mockupy, poté malé zásahy s regresí sousedních stránek. |
| D11 | Potvrzeno metodou auditu | Zdrojový stav, lokální test, dřívější výsledek buildu a nová runtime zkouška se nesmějí vydávat za stejnou úroveň důkazu. |
| D12 | Chybí konkrétní artefakty | Respektujeme deklarované schválení některých návrhů v části M masteru, ale přesné verze nejsou přiložené. Registr odděluje schválený směr, deklaraci návrhu a dostupnost obrázku. |
| D13 | Potvrzeno rozsahem | Produkční migrace, DNS, Stripe, Resend, Supabase Auth a změny GitHub nastavení se v P00 neprovádějí. |
| D14 | Potvrzeno pracovním stromem | Před P00 existovalo změněné `next-env.d.ts` a dva `.DS_Store`. Nejsou součástí auditu ani navrženého PR. |
| D15 | Potvrzeno zadáním | Po předání reportu zastavit; až schválení dovolí pokračovat do další fáze. |

## Rozpory k rozhodnutí vlastníkem návrhu

1. Starý brief „bez CSS Modules“ × současné moduly: dodaný master preferuje zachování vhodných knihoven a malé změny; zákaz ze starého briefu se automaticky neuplatňuje. P00 nic nemigruje.
2. Starý brief „celá aplikace pouze česky“ × implementované EN varianty: potvrdit jazykovou matici v návrzích.
3. Starý popis společných upomínek/šablon × dnešní dvě routy: schválit navigaci pro dvě stránky a sdílené nastavení.
4. Brandový návrh v `docs/brand/SPLATNO-V2.md` × aktuální tokeny: směr nyní stanoví část A master plánu. Přesné tokeny a asset verze doplní P01; neodvozovat HEX z JPEG.
5. Statické auth/onboarding obrazovky × velmi nízká okna / klávesnice / zvětšení: návrh musí určit bezpečné zobrazení všech polí a CTA. Univerzální `overflow:hidden` není schválené řešení; případný vnitřní scroll vyžaduje návrh a zkoušku.

## Registr schválení

Master plán deklaruje existující schválení některých návrhů a schválený vizuální směr. Konkrétní soubory/verze dosud nedodány; další fáze nebyly aktuálním dodáním plánů povoleny. Při dodání mockupu uvést: R/ST identifikátory, URL nebo cestu, frame/node, verzi/datum, schvalující osobu a datum, mobil/tablet/desktop, chybové/loading/role stavy. Bez těchto údajů zůstává příslušné PR návrhem.

## Doplnění po dodání plánů

| ID | Stav | Rozhodnutí |
| --- | --- | --- |
| D16 | Potvrzeno dodaným masterem | Zachovat produkt evidování existující faktury; PDF/e-mail zachovat, nový vystavovací modul nepřidávat. |
| D17 | Potvrzeno zdroji | CSV import je atomický; P08 partial success/mapování není důvod změnit zápis. C02 vyžaduje samostatné vyjasnění, pokud by šlo o požadavek nové funkce. |
| D18 | Otevřená P00 podmínka | D.5 požaduje novou bezpečnou screenshotovou baseline; historické reference ji nenahrazují. P00 proto není označena dokončeno. |
| D19 | Potvrzeno rozsahem | Plány jsou podklady pro pokračování již zadané P00; nikoli blanketní příkaz implementovat P01–P18 ani příkaz commitnout/pushnout. |
| D20 | Návrh upřesnění | Šířku 1200 px v template doplnit jako desktop ≥1200 v testovací specifikaci; současný CSS se nemění. Před implementací potvrdit v komponentové specifikaci. |

Úplné porovnání C01–C08 je v `02-design-contract.md`; oficiální fázový PR rozpad v 06, skutečný stav návrhů v `mockup-register.md`.

## SPL-DASH-001 — aktuální uživatelské zadání

| ID | Stav | Rozhodnutí |
| --- | --- | --- |
| D21 | Výslovně zadáno uživatelem | Dodaný dashboard CODEX pack se nyní implementuje. Dřívější pauza P00 neblokuje konkrétní nově zadaný rozsah; nepovažuje se za souhlas s celým P01–P18. |
| D22 | Zachovaný kontrakt | Údaje se čerpají z původního dashboardu a existujících read-only invoice/report endpointů. Žádná změna API/RLS/schema/financial/reminder logiky. |
| D23 | Implementováno | Dashboard má vlastní scoped CSS, původní shell zůstává na ostatních routách. Produktová značka je nahoře, vlastní firemní logo lze zobrazit dole u profilu. |
| D24 | Zdokumentovaná odchylka | Graf a recent tabulka mají názvy odpovídající skutečné definici dat. Bez fake notifikací, duplicitního profilu, růstových procent nebo neexistujícího pause/menu. |
| D25 | Ověření s mezí | 64 nových browser fixture průchodů není authenticated Next/Supabase E2E. Baseline P00 pro všechny ostatní routy zůstává otevřená. |
