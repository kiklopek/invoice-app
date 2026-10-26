# P00 — úplná inventura obrazovek a stavů

Baseline `f0f5fcb`, 17. 10. 2026. **28 skutečných stránek; 64 API rout se nepočítá jako obrazovky.** Master plán deklaruje schválení části návrhů; **konkrétní artefakty/verze zatím nedodány**. Stav po jednotlivých návrzích je v [registru mockupů](mockup-register.md). Inventura je audit kódu a existujícího checklistu, nikoli potvrzení nového runtime ověření všech variant.

## Registr stránek

R identifikátor určuje stránku. ST identifikátor níže určuje návrhový stav nebo požadavek průřezové kontroly; nevytváří novou routu. U každého implementačního PR uvést obojí, relevantní roli a velikost okna. Detail smluv a příslušné API je v dokumentu 03.

Role: veřejné = bez relace; auth = podle stavu ověření; onboarding = ověřený zakladatel/nedokončená firma; A = admin, U = accounting, Č = viewer; O = provozovatel. Support není samostatná běžná role. Oprávnění k akci může být užší než otevření stránky.

| ID | URL | Hlavní role | Skutečný vstupní soubor |
| --- | --- | --- | --- |
| R01 | `/forgot-password` | auth / veřejné dle stavu | `src/app/(auth)/forgot-password/page.tsx` |
| R02 | `/hlavica` | auth / veřejné dle stavu | `src/app/(auth)/hlavica/page.tsx` |
| R03 | `/hlavica/registrace` | auth / veřejné dle stavu | `src/app/(auth)/hlavica/registrace/page.tsx` |
| R04 | `/login` | auth / veřejné dle stavu | `src/app/(auth)/login/page.tsx` |
| R05 | `/mfa` | auth / veřejné dle stavu | `src/app/(auth)/mfa/page.tsx` |
| R06 | `/pozvanka/[token]` | auth / veřejné dle stavu | `src/app/(auth)/pozvanka/[token]/page.tsx` |
| R07 | `/register` | auth / veřejné dle stavu | `src/app/(auth)/register/page.tsx` |
| R08 | `/reset-password` | auth / veřejné dle stavu | `src/app/(auth)/reset-password/page.tsx` |
| R09 | `/en` | veřejné | `src/app/(landing)/en/page.tsx` |
| R10 | `/` | veřejné | `src/app/(landing)/page.tsx` |
| R11 | `/ochrana-osobnich-udaju` | veřejné | `src/app/(legal)/ochrana-osobnich-udaju/page.tsx` |
| R12 | `/podminky` | veřejné | `src/app/(legal)/podminky/page.tsx` |
| R13 | `/onboarding` | onboarding | `src/app/(onboarding)/onboarding/page.tsx` |
| R14 | `/provoz` | O | `src/app/(operator)/provoz/page.tsx` |
| R15 | `/customers` | A, U, Č | `src/app/(workspace)/customers/page.tsx` |
| R16 | `/dashboard` | A, U, Č | `src/app/(workspace)/dashboard/page.tsx` |
| R17 | `/invoices/[id]` | A, U, Č | `src/app/(workspace)/invoices/[id]/page.tsx` |
| R18 | `/invoices/archive` | A, U; akce dle serverové role | `src/app/(workspace)/invoices/archive/page.tsx` |
| R19 | `/invoices/import` | A, U; akce dle serverové role | `src/app/(workspace)/invoices/import/page.tsx` |
| R20 | `/invoices/new` | A, U; akce dle serverové role | `src/app/(workspace)/invoices/new/page.tsx` |
| R21 | `/invoices` | A, U, Č | `src/app/(workspace)/invoices/page.tsx` |
| R22 | `/invoices/payments/archive` | A, U; akce dle serverové role | `src/app/(workspace)/invoices/payments/archive/page.tsx` |
| R23 | `/invoices/payments` | A, U; akce dle serverové role | `src/app/(workspace)/invoices/payments/page.tsx` |
| R24 | `/predplatne` | A, U; akce dle serverové role | `src/app/(workspace)/predplatne/page.tsx` |
| R25 | `/reminders` | A, U; akce dle serverové role | `src/app/(workspace)/reminders/page.tsx` |
| R26 | `/reports` | A, U, Č | `src/app/(workspace)/reports/page.tsx` |
| R27 | `/settings/email-template` | A, U; akce dle serverové role | `src/app/(workspace)/settings/email-template/page.tsx` |
| R28 | `/settings` | A, U; akce dle serverové role | `src/app/(workspace)/settings/page.tsx` |

## Metadata jednotlivých tras podle master plánu

[Strojově čitelný registr všech 28 obrazovek](screens/route-register.json) obsahuje pro každou R položku požadované `route`, `owner`, `mockup`, `status`, `functional_contract`, `states`, `responsive`, `tests`, `last_verified` a oddělenou vizuální/funkční akceptaci. Owner a konkrétní mockup verze zůstávají `null`, pokud nebyly dodány; `last_verified` odděluje audit zdroje od dosud neprovedeného runtime a vizuálního ověření. Názvy existujících testů nejsou tvrzení o úplném pokrytí stránky.

R/ST identifikátory z prvního auditu jsou zachovány. Existujících 16 tematických sekcí se mapuje na oficiální fáze P00–P18 v dokumentu 06; z odkazu masteru na 18 kapitol se nevyrábějí nové fiktivní obrazovky (rozdíl C05).

## Stavové pokrytí

Následuje úplný stavový checklist z `docs/redesign-screen-checklist.md`, očíslovaný pro vazbu na mockupy a PR. Původní checklist byl převzat jako návrhový rozsah; odškrtnutí znamená až doložené schválení/ověření v další fázi, nikoli pouhé nalezení souboru. Některé položky jsou kontrolní scénáře (např. timeout), nikoli samostatné existující komponenty. Role a omezení ověřovat podle dokumentu 03.

Ke každému ST doplnit při schvalování: konkrétní frame/node, verzi, kdo/kdy schválil, relevantní breakpointy, texty a klávesové chování. Tento audit neprohlašuje nedodaný soubor za vizuálně ověřenou implementační referenci; deklarace schválení z masteru jsou zachovány v registru.

## 1. Veřejný web — 4 stránky

- [ ] **ST-001** `/` — česká landing page.
- [ ] **ST-002** `/en` — anglická landing page.
- [ ] **ST-003** `/podminky` — obchodní podmínky.
- [ ] **ST-004** `/ochrana-osobnich-udaju` — ochrana osobních údajů.

Landing page:
- [ ] **ST-005** Hlavička: logo, navigace, jazyk, přihlášení a registrace; mobilní varianta.
- [ ] **ST-006** Hero: nadpis, CTA, spuštění videa, benefity, dashboard a maskot.
- [ ] **ST-007** Známá situace: text a propojení účetnictví/banky/e-mailu/Excelu.
- [ ] **ST-008** Proces od faktury k zaplacení: všechny 3 kroky a scroll animace.
- [ ] **ST-009** Sekce vyžadující pozornost.
- [ ] **ST-010** Pro koho je produkt.
- [ ] **ST-011** Ceník: tarify a měsíční/roční platba.
- [ ] **ST-012** FAQ: zavřené i otevřené odpovědi.
- [ ] **ST-013** Závěrečné CTA a patička.
- [ ] **ST-014** Video: otevřený přehrávač, přehrávání a zavření.

## 2. Přihlášení a registrace — 8 stránek

- [ ] **ST-015** `/login` — přihlášení, zapamatování přihlášení a chyby.
- [ ] **ST-016** `/register` — založení firemního účtu.
- [ ] **ST-017** `/mfa` — ověření přihlašovacím kódem.
- [ ] **ST-018** `/forgot-password` — žádost o obnovu hesla a potvrzení o odeslání.
- [ ] **ST-019** `/reset-password` — nastavení nového hesla, neplatné ověření a dokončení.
- [ ] **ST-020** `/pozvanka/[token]` — přijetí firemní pozvánky.
- [ ] **ST-021** `/hlavica` — firemní přihlašovací vstup Hlavica.
- [ ] **ST-022** `/hlavica/registrace` — firemní registrační vstup Hlavica.

Varianty:
- [ ] **ST-023** Registrace: formulář → zadání ověřovacího kódu → ověřování/dokončení.
- [ ] **ST-024** Kód: prázdný, částečně vyplněný, vyplněný, chybný, prošlý.
- [ ] **ST-025** Opakované odeslání kódu: odpočet, odesílání, chyba a omezení pokusů.
- [ ] **ST-026** Zobrazení/skrytí hesla a validace polí.
- [ ] **ST-027** Pozvánka pro nového a již existujícího uživatele.
- [ ] **ST-028** Pozvánka neplatná, prošlá nebo dočasně nedostupná; přihlášení pod jiným účtem.
- [ ] **ST-029** Ověřený uživatel bez dokončeného onboardingu.
- [ ] **ST-030** České a anglické autentizační texty.

## 3. Onboarding — 1 stránka, 8 kroků

Adresa `/onboarding`:
- [ ] **ST-031** 1. Vaše firma: IČO, název, DIČ, sídlo a plátcovství DPH.
- [ ] **ST-032** 2. Kontakt: e-mail, telefon, datová schránka a provozovna.
- [ ] **ST-033** 3. Bankovní účet: korunový a eurový účet.
- [ ] **ST-034** 4. Upomínky: termíny, adresa odpovědí a kopie.
- [ ] **ST-035** 5. Logo: prázdný výběr, nahrané logo a chyba souboru.
- [ ] **ST-036** 6. Tým: prázdný seznam, více kolegů, role, odebrání a validace.
- [ ] **ST-037** 7. Shrnutí: kontrola údajů a návraty k jejich úpravě.
- [ ] **ST-038** 8. Tarif a karta: tarify, období, zkušební doba a předání k platbě.
- [ ] **ST-039** ARES: hledání, nalezená firma, nenalezená firma a výpadek registru.
- [ ] **ST-040** Průběžný ukazatel kroků: aktivní, hotový a budoucí krok.
- [ ] **ST-041** Obnovení rozpracovaného onboardingu a neúspěšné ukládání konceptu.
- [ ] **ST-042** Potvrzení odeslání pozvánek po založení firmy.
- [ ] **ST-043** Ukládání, chyba založení, problém s logem/pozvánkami nebo platbou.
- [ ] **ST-044** Varianta bez nároku na zkušební dobu a okamžitá platba.

## 4. Přehled — 1 stránka

- [ ] **ST-045** `/dashboard` — hlavní dashboard.
- [ ] **ST-046** Souhrny, grafy a přehled položek vyžadujících pozornost.
- [ ] **ST-047** Seznamy faktur a jejich stavů; přechod do detailu.
- [ ] **ST-048** Prázdná firma bez faktur a běžný dashboard s daty.

## 5. Faktury — 5 stránek

- [ ] **ST-049** `/invoices` — aktivní faktury, vyhledávání, filtry, řazení a stránkování.
- [ ] **ST-050** `/invoices/new` — ruční založení faktury.
- [ ] **ST-051** `/invoices/import` — import dokumentů a CSV.
- [ ] **ST-052** `/invoices/[id]` — detail a úprava faktury.
- [ ] **ST-053** `/invoices/archive` — archiv, hledání a filtrování archivovaných/stornovaných faktur.

Seznam a detail:
- [ ] **ST-054** Faktura neuhrazená, po splatnosti, částečně uhrazená, zaplacená a stornovaná.
- [ ] **ST-055** Rychlá akce úhrady v seznamu.
- [ ] **ST-056** Detail: základní údaje, odběratel a kontakt.
- [ ] **ST-057** Detail: spárované platby a jejich uvolnění.
- [ ] **ST-058** Detail: interní poznámka a historie změn.
- [ ] **ST-059** Detail: automatické upomínky a historie jejich odeslání.
- [ ] **ST-060** Detail: dokument a jeho náhled; stav bez dokumentu.
- [ ] **ST-061** Editace údajů a validace formuláře.
- [ ] **ST-062** Potvrzení úhrady: bankovní platba versus výslovně potvrzená ruční úhrada.
- [ ] **ST-063** Odeslání faktury e-mailem a potvrzovací dialog.
- [ ] **ST-064** Storno, vrácení mezi neuhrazené a smazání faktury.

Import faktur:
- [ ] **ST-065** Výběr jednoho nebo více dokumentů.
- [ ] **ST-066** Nahrávání a vytěžování údajů.
- [ ] **ST-067** Fronta dokumentů: zpracovávaný, připravený, chybný a uložený dokument.
- [ ] **ST-068** Kontrola vytěžených údajů vedle náhledu dokumentu.
- [ ] **ST-069** Nejistá hodnota, kandidátní hodnoty a vysvětlení zdroje OCR.
- [ ] **ST-070** Mobilní přepínání Údaje / Doklad.
- [ ] **ST-071** Režim CSV: výběr souboru, náhled načtených faktur, chyby a výsledek importu.

## 6. Bankovní platby — 2 stránky

- [ ] **ST-072** `/invoices/payments` — nahrání a párování bankovního výpisu.
- [ ] **ST-073** `/invoices/payments/archive` — platby a archiv výpisů.

Import:
- [ ] **ST-074** Úvodní výběr jednoho/více souborů GPC nebo CSV; CAMT podle zapnuté funkce.
- [ ] **ST-075** Analýza a chyba načítání souboru.
- [ ] **ST-076** Pracovní přehled výpisu bez úvodního hero.
- [ ] **ST-077** Souhrny, filtry položek, hledání faktury a stránkování.
- [ ] **ST-078** Jednoznačně navržená shoda.
- [ ] **ST-079** Nejasná nebo nenalezená shoda a ruční přiřazení.
- [ ] **ST-080** Rozdělení platby mezi faktury a částečná úhrada.
- [ ] **ST-081** Platba nesouvisející s fakturami a vlastní převod.
- [ ] **ST-082** Ignorované položky, chyby a možné duplicity.
- [ ] **ST-083** Již nahraný výpis.
- [ ] **ST-084** Nesoulad účtu a jeho potvrzení; neověřená banka.
- [ ] **ST-085** Potvrzovací dialog zaúčtování a probíhající zpracování.
- [ ] **ST-086** Úspěšné dokončení, částečné dokončení a položkové chyby.
- [ ] **ST-087** Více souborů ve frontě a změna souboru s rozpracovanými úpravami.

Archiv:
- [ ] **ST-088** Historie importovaných plateb s hledáním a filtrem stavu.
- [ ] **ST-089** Spárované, rozdělené, nespárované a nejednoznačné platby.
- [ ] **ST-090** Ruční řešení/přiřazení plateb a panel asistence párování.
- [ ] **ST-091** Archiv originálních výpisů: ke kontrole, zaúčtované a zahozené.
- [ ] **ST-092** Stažení originálu a potvrzení zahození výpisu.

## 7. Zákazníci — 1 stránka

- [ ] **ST-093** `/customers` — seznam, hledání, řazení a počet zákazníků.
- [ ] **ST-094** Identita zákazníka: iniciála, název, IČO, DIČ a adresa.
- [ ] **ST-095** Kontakt: vyplněný a chybějící e-mail/telefon.
- [ ] **ST-096** Editace e-mailu, validace a potvrzení změny příjemce upomínek.
- [ ] **ST-097** Editace telefonu, validace a chyba uložení.
- [ ] **ST-098** Fakturace, neuhrazeno, kategorie upomínek a poslední faktura.
- [ ] **ST-099** Vysoké částky ve stovkách milionů a dlouhé názvy/adresy/e-maily.
- [ ] **ST-100** Mobilní karta zákazníka a označení zákazníka po příchodu z faktury.
- [ ] **ST-101** Export do Excelu: spouštění a chyba.

Samostatná detailová stránka zákazníka nyní neexistuje. Odkaz z adresáře vede na jeho filtrované faktury.

## 8. Reporty — 1 stránka, 4 hlavní pohledy

- [ ] **ST-102** `/reports` — období, odběratel, měna a další dostupné filtry.
- [ ] **ST-103** Tržby: vývoj, souhrny a průměrná faktura.
- [ ] **ST-104** DPH: rozpis sazeb a struktura daně.
- [ ] **ST-105** Pohledávky: stavy faktur, stáří dluhu, doba úhrady a dlužníci.
- [ ] **ST-106** Platby: úspěšnost párování a poslední potvrzené výpisy.
- [ ] **ST-107** Výběr odběratele z reportu a změna filtrů.
- [ ] **ST-108** Prázdné období, načítání, chyba a tiskový výstup.

## 9. Nastavení firmy a týmu — 1 stránka

- [ ] **ST-109** `/settings` — firemní údaje, kontakty, platební a doplňující údaje.
- [ ] **ST-110** Plátce/neplátce DPH.
- [ ] **ST-111** Další bankovní účty: seznam, prázdný stav, přidání a odebrání.
- [ ] **ST-112** Tým: aktivní členové, čekající a prošlé pozvánky.
- [ ] **ST-113** Přidání kolegy, role a potvrzení odeslání pozvánky.
- [ ] **ST-114** Opakované odeslání pozvánky.
- [ ] **ST-115** Změna role a odebrání přístupu.
- [ ] **ST-116** Historie přístupů a vstupy podpory.
- [ ] **ST-117** Ukončení přístupu podpory.
- [ ] **ST-118** Neuložený koncept, obnova konceptu, konflikt verze a chyby polí.
- [ ] **ST-119** Administrátor versus účetní s údaji pouze pro čtení.

## 10. Upomínky — 1 stránka

- [ ] **ST-120** `/reminders` — automat zapnutý a pozastavený, neuložená změna přepínače.
- [ ] **ST-121** Kategorie/harmonogram: výběr, nová kategorie a úprava existující.
- [ ] **ST-122** Přidání, úprava a odebrání termínu.
- [ ] **ST-123** Výchozí kategorie a odstranění kategorie.
- [ ] **ST-124** Názorný časový průběh harmonogramu.
- [ ] **ST-125** Spuštění ruční kontroly a potvrzení rozsahu odesílání.
- [ ] **ST-126** Stav běhu automatu, nedokončený běh, částečný výsledek a chyba.
- [ ] **ST-127** Naplánované, odeslané a neúspěšné upomínky.
- [ ] **ST-128** Problém s doručením a další pokus o odeslání.
- [ ] **ST-129** Blokované e-mailové adresy a potvrzení jejich odblokování.

## 11. E-mailová šablona — 1 stránka

- [ ] **ST-130** `/settings/email-template` — samostatný editor.
- [ ] **ST-131** Před splatností / V den splatnosti / Po splatnosti / Důrazná upomínka.
- [ ] **ST-132** Pevný předmět a editace těla zprávy.
- [ ] **ST-133** Vkládání proměnných faktury a vrácení doporučeného textu.
- [ ] **ST-134** Odpovědi a kopie: sbalené, rozbalené, vyplněné a neplatné adresy.
- [ ] **ST-135** Logo: výchozí, vlastní, nahrávání, úspěšná fajfka a chyba souboru.
- [ ] **ST-136** Změna a odebrání loga; varianta bez oprávnění měnit logo.
- [ ] **ST-137** Náhled e-mailu s QR platbou a bez použitelného bankovního účtu.
- [ ] **ST-138** Mobilní přepínání editoru a náhledu.
- [ ] **ST-139** Testovací odeslání: odesílání, úspěch a chyba.
- [ ] **ST-140** Ukládání, chyba, neuložený koncept a konflikt změn.

## 12. Předplatné — 1 stránka

- [ ] **ST-141** `/predplatne` — aktuální tarif, období a platební informace.
- [ ] **ST-142** Zkušební doba a využití limitu faktur.
- [ ] **ST-143** Aktivní předplatné, neúspěšná platba a přístup bez běžného účtování.
- [ ] **ST-144** Výběr tarifu a měsíční/roční platby.
- [ ] **ST-145** Náhled změny tarifu a její potvrzení.
- [ ] **ST-146** Ukončení zkušební doby a zahájení placení.
- [ ] **ST-147** Plánovaná změna tarifu a její zrušení.
- [ ] **ST-148** Zrušení předplatného a obnovení pokračování.
- [ ] **ST-149** Přesměrování ke kartě/platbě, návrat z platební brány a chyba platby.

Externí platební a zákaznický portál Stripe není vlastní obrazovka Splatna; vlastní jsou vstupní a návratové stavy aplikace.

## 13. Interní provoz — 1 stránka

- [ ] **ST-150** `/provoz` — konzole provozu Splatna a seznam firem.
- [ ] **ST-151** Vyhledání firmy a podklady pro vstup podpory.
- [ ] **ST-152** Potvrzení dočasného vstupu podpory do firmy.
- [ ] **ST-153** Aktivní podpůrná relace a návrat/ukončení podpory.

## 14. Společné prvky aplikace

- [ ] **ST-154** Desktopová navigace: aktivní položky a podstránky.
- [ ] **ST-155** Mobilní navigace, rozbalené menu a uživatelský účet.
- [ ] **ST-156** Logo firmy, výchozí značka a selhání načtení obrázku.
- [ ] **ST-157** Odhlášení a jeho chyba.
- [ ] **ST-158** Banner předplatného, omezeného přístupu a aktivní podpory.
- [ ] **ST-159** Asistent Eško: zavřený, otevřený, prázdná konverzace, dotaz, odpověď, načítání a chyba.
- [ ] **ST-160** Potvrzovací dialogy, vlastní modální formuláře a zavření klávesnicí.
- [ ] **ST-161** Toasty, úspěšné zprávy, upozornění a chyby u polí.
- [ ] **ST-162** Dialog neuložených změn a obnovení rozpracovaného konceptu.
- [ ] **ST-163** Rozbalovací panely, filtry, řazení, stránkování a ovládání výběru.

## 15. Systémové stavy

- [ ] **ST-164** Načítání aplikace a skeletony jednotlivých stránek.
- [ ] **ST-165** Prázdné seznamy a první použití bez dat.
- [ ] **ST-166** Hledání/filtry bez výsledku.
- [ ] **ST-167** Chyba stránky a opakování načtení.
- [ ] **ST-168** Globální chyba aplikace.
- [ ] **ST-169** Nenalezená stránka 404.
- [ ] **ST-170** Vypršení přihlášení a návrat po přihlášení.
- [ ] **ST-171** Omezená oprávnění nebo režim pouze pro čtení.
- [ ] **ST-172** Nedostupná funkce či prostředí — například zakázaný import výpisu.
- [ ] **ST-173** Selhání sítě, timeout, omezení pokusů a souběžná změna jiným uživatelem.

## 16. E-maily, dokumenty a tisk

- [ ] **ST-174** Registrační ověřovací e-mail.
- [ ] **ST-175** Přihlašovací ověřovací e-mail.
- [ ] **ST-176** Pozvánka do firmy.
- [ ] **ST-177** Obnova hesla.
- [ ] **ST-178** E-mail s fakturou.
- [ ] **ST-179** Upomínky ve všech 4 fázích, logo firmy / výchozí logo a QR / bez QR.
- [ ] **ST-180** PDF faktury a náhled PDF/obrázku v aplikaci.
- [ ] **ST-181** Tisk reportů.
- [ ] **ST-182** České/anglické varianty tam, kde je produkt skutečně nabízí.

Profilová ikona odesílatele v poštovní schránce je nastavení domény/poskytovatele pošty, nikoli obrazovka webové aplikace.

## Pravidla kontroly každé návrhové položky

- [ ] **ST-183** Mobil, tablet, desktop a šířky mezi breakpointy.
- [ ] **ST-184** Nízké okno, otočení zařízení a otevřená softwarová klávesnice.
- [ ] **ST-185** Krátká i dlouhá data; vysoké částky; jeden a mnoho záznamů.
- [ ] **ST-186** Prázdný, běžný, načítací, úspěšný a chybový stav, pokud existuje.
- [ ] **ST-187** Příslušné role: administrátor, účetní, čtenář a podpora.
- [ ] **ST-188** Klávesnice, viditelný focus, popisky, kontrast a omezené animace.
- [ ] **ST-189** Označování a kopírování textu, přístupnost akcí a žádný nechtěný přechod.
