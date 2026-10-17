# Checklist obrazovek pro redesign Splatna

Inventura aktuálního pracovního stromu k 17. 10. 2026. Zahrnuje i dosud necommitnuté úpravy. V aplikaci existuje 28 souborů `page.tsx`; jeden URL může obsahovat několik návrhově odlišných stavů. Níže se samostatně evidují stránky, jejich pohledy, dialogy a výstupy. Nejde o návrh nových podstránek.

## 1. Veřejný web — 4 stránky

- [ ] `/` — česká landing page.
- [ ] `/en` — anglická landing page.
- [ ] `/podminky` — obchodní podmínky.
- [ ] `/ochrana-osobnich-udaju` — ochrana osobních údajů.

Landing page:
- [ ] Hlavička: logo, navigace, jazyk, přihlášení a registrace; mobilní varianta.
- [ ] Hero: nadpis, CTA, spuštění videa, benefity, dashboard a maskot.
- [ ] Známá situace: text a propojení účetnictví/banky/e-mailu/Excelu.
- [ ] Proces od faktury k zaplacení: všechny 3 kroky a scroll animace.
- [ ] Sekce vyžadující pozornost.
- [ ] Pro koho je produkt.
- [ ] Ceník: tarify a měsíční/roční platba.
- [ ] FAQ: zavřené i otevřené odpovědi.
- [ ] Závěrečné CTA a patička.
- [ ] Video: otevřený přehrávač, přehrávání a zavření.

## 2. Přihlášení a registrace — 8 stránek

- [ ] `/login` — přihlášení, zapamatování přihlášení a chyby.
- [ ] `/register` — založení firemního účtu.
- [ ] `/mfa` — ověření přihlašovacím kódem.
- [ ] `/forgot-password` — žádost o obnovu hesla a potvrzení o odeslání.
- [ ] `/reset-password` — nastavení nového hesla, neplatné ověření a dokončení.
- [ ] `/pozvanka/[token]` — přijetí firemní pozvánky.
- [ ] `/hlavica` — firemní přihlašovací vstup Hlavica.
- [ ] `/hlavica/registrace` — firemní registrační vstup Hlavica.

Varianty:
- [ ] Registrace: formulář → zadání ověřovacího kódu → ověřování/dokončení.
- [ ] Kód: prázdný, částečně vyplněný, vyplněný, chybný, prošlý.
- [ ] Opakované odeslání kódu: odpočet, odesílání, chyba a omezení pokusů.
- [ ] Zobrazení/skrytí hesla a validace polí.
- [ ] Pozvánka pro nového a již existujícího uživatele.
- [ ] Pozvánka neplatná, prošlá nebo dočasně nedostupná; přihlášení pod jiným účtem.
- [ ] Ověřený uživatel bez dokončeného onboardingu.
- [ ] České a anglické autentizační texty.

## 3. Onboarding — 1 stránka, 8 kroků

Adresa `/onboarding`:
- [ ] 1. Vaše firma: IČO, název, DIČ, sídlo a plátcovství DPH.
- [ ] 2. Kontakt: e-mail, telefon, datová schránka a provozovna.
- [ ] 3. Bankovní účet: korunový a eurový účet.
- [ ] 4. Upomínky: termíny, adresa odpovědí a kopie.
- [ ] 5. Logo: prázdný výběr, nahrané logo a chyba souboru.
- [ ] 6. Tým: prázdný seznam, více kolegů, role, odebrání a validace.
- [ ] 7. Shrnutí: kontrola údajů a návraty k jejich úpravě.
- [ ] 8. Tarif a karta: tarify, období, zkušební doba a předání k platbě.
- [ ] ARES: hledání, nalezená firma, nenalezená firma a výpadek registru.
- [ ] Průběžný ukazatel kroků: aktivní, hotový a budoucí krok.
- [ ] Obnovení rozpracovaného onboardingu a neúspěšné ukládání konceptu.
- [ ] Potvrzení odeslání pozvánek po založení firmy.
- [ ] Ukládání, chyba založení, problém s logem/pozvánkami nebo platbou.
- [ ] Varianta bez nároku na zkušební dobu a okamžitá platba.

## 4. Přehled — 1 stránka

- [ ] `/dashboard` — hlavní dashboard.
- [ ] Souhrny, grafy a přehled položek vyžadujících pozornost.
- [ ] Seznamy faktur a jejich stavů; přechod do detailu.
- [ ] Prázdná firma bez faktur a běžný dashboard s daty.

## 5. Faktury — 5 stránek

- [ ] `/invoices` — aktivní faktury, vyhledávání, filtry, řazení a stránkování.
- [ ] `/invoices/new` — ruční založení faktury.
- [ ] `/invoices/import` — import dokumentů a CSV.
- [ ] `/invoices/[id]` — detail a úprava faktury.
- [ ] `/invoices/archive` — archiv, hledání a filtrování archivovaných/stornovaných faktur.

Seznam a detail:
- [ ] Faktura neuhrazená, po splatnosti, částečně uhrazená, zaplacená a stornovaná.
- [ ] Rychlá akce úhrady v seznamu.
- [ ] Detail: základní údaje, odběratel a kontakt.
- [ ] Detail: spárované platby a jejich uvolnění.
- [ ] Detail: interní poznámka a historie změn.
- [ ] Detail: automatické upomínky a historie jejich odeslání.
- [ ] Detail: dokument a jeho náhled; stav bez dokumentu.
- [ ] Editace údajů a validace formuláře.
- [ ] Potvrzení úhrady: bankovní platba versus výslovně potvrzená ruční úhrada.
- [ ] Odeslání faktury e-mailem a potvrzovací dialog.
- [ ] Storno, vrácení mezi neuhrazené a smazání faktury.

Import faktur:
- [ ] Výběr jednoho nebo více dokumentů.
- [ ] Nahrávání a vytěžování údajů.
- [ ] Fronta dokumentů: zpracovávaný, připravený, chybný a uložený dokument.
- [ ] Kontrola vytěžených údajů vedle náhledu dokumentu.
- [ ] Nejistá hodnota, kandidátní hodnoty a vysvětlení zdroje OCR.
- [ ] Mobilní přepínání Údaje / Doklad.
- [ ] Režim CSV: výběr souboru, náhled načtených faktur, chyby a výsledek importu.

## 6. Bankovní platby — 2 stránky

- [ ] `/invoices/payments` — nahrání a párování bankovního výpisu.
- [ ] `/invoices/payments/archive` — platby a archiv výpisů.

Import:
- [ ] Úvodní výběr jednoho/více souborů GPC nebo CSV; CAMT podle zapnuté funkce.
- [ ] Analýza a chyba načítání souboru.
- [ ] Pracovní přehled výpisu bez úvodního hero.
- [ ] Souhrny, filtry položek, hledání faktury a stránkování.
- [ ] Jednoznačně navržená shoda.
- [ ] Nejasná nebo nenalezená shoda a ruční přiřazení.
- [ ] Rozdělení platby mezi faktury a částečná úhrada.
- [ ] Platba nesouvisející s fakturami a vlastní převod.
- [ ] Ignorované položky, chyby a možné duplicity.
- [ ] Již nahraný výpis.
- [ ] Nesoulad účtu a jeho potvrzení; neověřená banka.
- [ ] Potvrzovací dialog zaúčtování a probíhající zpracování.
- [ ] Úspěšné dokončení, částečné dokončení a položkové chyby.
- [ ] Více souborů ve frontě a změna souboru s rozpracovanými úpravami.

Archiv:
- [ ] Historie importovaných plateb s hledáním a filtrem stavu.
- [ ] Spárované, rozdělené, nespárované a nejednoznačné platby.
- [ ] Ruční řešení/přiřazení plateb a panel asistence párování.
- [ ] Archiv originálních výpisů: ke kontrole, zaúčtované a zahozené.
- [ ] Stažení originálu a potvrzení zahození výpisu.

## 7. Zákazníci — 1 stránka

- [ ] `/customers` — seznam, hledání, řazení a počet zákazníků.
- [ ] Identita zákazníka: iniciála, název, IČO, DIČ a adresa.
- [ ] Kontakt: vyplněný a chybějící e-mail/telefon.
- [ ] Editace e-mailu, validace a potvrzení změny příjemce upomínek.
- [ ] Editace telefonu, validace a chyba uložení.
- [ ] Fakturace, neuhrazeno, kategorie upomínek a poslední faktura.
- [ ] Vysoké částky ve stovkách milionů a dlouhé názvy/adresy/e-maily.
- [ ] Mobilní karta zákazníka a označení zákazníka po příchodu z faktury.
- [ ] Export do Excelu: spouštění a chyba.

Samostatná detailová stránka zákazníka nyní neexistuje. Odkaz z adresáře vede na jeho filtrované faktury.

## 8. Reporty — 1 stránka, 4 hlavní pohledy

- [ ] `/reports` — období, odběratel, měna a další dostupné filtry.
- [ ] Tržby: vývoj, souhrny a průměrná faktura.
- [ ] DPH: rozpis sazeb a struktura daně.
- [ ] Pohledávky: stavy faktur, stáří dluhu, doba úhrady a dlužníci.
- [ ] Platby: úspěšnost párování a poslední potvrzené výpisy.
- [ ] Výběr odběratele z reportu a změna filtrů.
- [ ] Prázdné období, načítání, chyba a tiskový výstup.

## 9. Nastavení firmy a týmu — 1 stránka

- [ ] `/settings` — firemní údaje, kontakty, platební a doplňující údaje.
- [ ] Plátce/neplátce DPH.
- [ ] Další bankovní účty: seznam, prázdný stav, přidání a odebrání.
- [ ] Tým: aktivní členové, čekající a prošlé pozvánky.
- [ ] Přidání kolegy, role a potvrzení odeslání pozvánky.
- [ ] Opakované odeslání pozvánky.
- [ ] Změna role a odebrání přístupu.
- [ ] Historie přístupů a vstupy podpory.
- [ ] Ukončení přístupu podpory.
- [ ] Neuložený koncept, obnova konceptu, konflikt verze a chyby polí.
- [ ] Administrátor versus účetní s údaji pouze pro čtení.

## 10. Upomínky — 1 stránka

- [ ] `/reminders` — automat zapnutý a pozastavený, neuložená změna přepínače.
- [ ] Kategorie/harmonogram: výběr, nová kategorie a úprava existující.
- [ ] Přidání, úprava a odebrání termínu.
- [ ] Výchozí kategorie a odstranění kategorie.
- [ ] Názorný časový průběh harmonogramu.
- [ ] Spuštění ruční kontroly a potvrzení rozsahu odesílání.
- [ ] Stav běhu automatu, nedokončený běh, částečný výsledek a chyba.
- [ ] Naplánované, odeslané a neúspěšné upomínky.
- [ ] Problém s doručením a další pokus o odeslání.
- [ ] Blokované e-mailové adresy a potvrzení jejich odblokování.

## 11. E-mailová šablona — 1 stránka

- [ ] `/settings/email-template` — samostatný editor.
- [ ] Před splatností / V den splatnosti / Po splatnosti / Důrazná upomínka.
- [ ] Pevný předmět a editace těla zprávy.
- [ ] Vkládání proměnných faktury a vrácení doporučeného textu.
- [ ] Odpovědi a kopie: sbalené, rozbalené, vyplněné a neplatné adresy.
- [ ] Logo: výchozí, vlastní, nahrávání, úspěšná fajfka a chyba souboru.
- [ ] Změna a odebrání loga; varianta bez oprávnění měnit logo.
- [ ] Náhled e-mailu s QR platbou a bez použitelného bankovního účtu.
- [ ] Mobilní přepínání editoru a náhledu.
- [ ] Testovací odeslání: odesílání, úspěch a chyba.
- [ ] Ukládání, chyba, neuložený koncept a konflikt změn.

## 12. Předplatné — 1 stránka

- [ ] `/predplatne` — aktuální tarif, období a platební informace.
- [ ] Zkušební doba a využití limitu faktur.
- [ ] Aktivní předplatné, neúspěšná platba a přístup bez běžného účtování.
- [ ] Výběr tarifu a měsíční/roční platby.
- [ ] Náhled změny tarifu a její potvrzení.
- [ ] Ukončení zkušební doby a zahájení placení.
- [ ] Plánovaná změna tarifu a její zrušení.
- [ ] Zrušení předplatného a obnovení pokračování.
- [ ] Přesměrování ke kartě/platbě, návrat z platební brány a chyba platby.

Externí platební a zákaznický portál Stripe není vlastní obrazovka Splatna; vlastní jsou vstupní a návratové stavy aplikace.

## 13. Interní provoz — 1 stránka

- [ ] `/provoz` — konzole provozu Splatna a seznam firem.
- [ ] Vyhledání firmy a podklady pro vstup podpory.
- [ ] Potvrzení dočasného vstupu podpory do firmy.
- [ ] Aktivní podpůrná relace a návrat/ukončení podpory.

## 14. Společné prvky aplikace

- [ ] Desktopová navigace: aktivní položky a podstránky.
- [ ] Mobilní navigace, rozbalené menu a uživatelský účet.
- [ ] Logo firmy, výchozí značka a selhání načtení obrázku.
- [ ] Odhlášení a jeho chyba.
- [ ] Banner předplatného, omezeného přístupu a aktivní podpory.
- [ ] Asistent Eško: zavřený, otevřený, prázdná konverzace, dotaz, odpověď, načítání a chyba.
- [ ] Potvrzovací dialogy, vlastní modální formuláře a zavření klávesnicí.
- [ ] Toasty, úspěšné zprávy, upozornění a chyby u polí.
- [ ] Dialog neuložených změn a obnovení rozpracovaného konceptu.
- [ ] Rozbalovací panely, filtry, řazení, stránkování a ovládání výběru.

## 15. Systémové stavy

- [ ] Načítání aplikace a skeletony jednotlivých stránek.
- [ ] Prázdné seznamy a první použití bez dat.
- [ ] Hledání/filtry bez výsledku.
- [ ] Chyba stránky a opakování načtení.
- [ ] Globální chyba aplikace.
- [ ] Nenalezená stránka 404.
- [ ] Vypršení přihlášení a návrat po přihlášení.
- [ ] Omezená oprávnění nebo režim pouze pro čtení.
- [ ] Nedostupná funkce či prostředí — například zakázaný import výpisu.
- [ ] Selhání sítě, timeout, omezení pokusů a souběžná změna jiným uživatelem.

## 16. E-maily, dokumenty a tisk

- [ ] Registrační ověřovací e-mail.
- [ ] Přihlašovací ověřovací e-mail.
- [ ] Pozvánka do firmy.
- [ ] Obnova hesla.
- [ ] E-mail s fakturou.
- [ ] Upomínky ve všech 4 fázích, logo firmy / výchozí logo a QR / bez QR.
- [ ] PDF faktury a náhled PDF/obrázku v aplikaci.
- [ ] Tisk reportů.
- [ ] České/anglické varianty tam, kde je produkt skutečně nabízí.

Profilová ikona odesílatele v poštovní schránce je nastavení domény/poskytovatele pošty, nikoli obrazovka webové aplikace.

## Pravidla kontroly každé návrhové položky

- [ ] Mobil, tablet, desktop a šířky mezi breakpointy.
- [ ] Nízké okno, otočení zařízení a otevřená softwarová klávesnice.
- [ ] Krátká i dlouhá data; vysoké částky; jeden a mnoho záznamů.
- [ ] Prázdný, běžný, načítací, úspěšný a chybový stav, pokud existuje.
- [ ] Příslušné role: administrátor, účetní, čtenář a podpora.
- [ ] Klávesnice, viditelný focus, popisky, kontrast a omezené animace.
- [ ] Označování a kopírování textu, přístupnost akcí a žádný nechtěný přechod.
