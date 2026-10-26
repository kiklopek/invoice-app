# Splatno – opravy designového auditu

Dokončeno 25. 10. 2026. Rozsah odpovídá schválenému plánu; bez nasazení, databázové migrace a změny veřejných API.

## Změny

- Esko má stálý vstup „Esko · pomocník“ v navigaci všech rolí. Plovoucí spouštěč, křížek a obnovovací záložka byly odstraněny. Staré nastavení skrytí se neuplatňuje.
- Viditelnost řídí kontext v AppShell. Chat používá společný nativní Modal, ponechává historii i rozepsaný text, načítá data až po otevření a vrací fokus na správný spouštěč. Na mobilu se nejprve zavře navigace. Dialog reaguje na visualViewport při otevření klávesnice.
- Společné proměnné sjednocují desktopové odsazení 20/32 px, od 1440 px 20/42 px, typografii a sekundární barvu. Mobilní výška navigace zůstává plynulá. Odstraněna dotčená přepsání na nástěnce a fakturách.
- Archiv faktur vykresluje textové stavy Zaplaceno/Stornováno v tabulce i kartách. Archiv plateb používá české datum, původní ISO zůstává v dateTime. Datum bez času se při formátování neposouvá.
- Upraveny pomocné údaje nástěnky, kontaktní vstupy a textové akce nastavení. Kontrast dotčených údajů karet je alespoň 4,5 : 1; dlouhé názvy a přesné částky jsou zachovány.
- Faktury používají karty do 1023 px a tabulku od 1024 px. Breakpoint společné navigace se nemění.
- Upomínky mají počet dní a vztah ke splatnosti vedle sebe i při 320 px. Volba v den splatnosti zabírá celý řádek. Horní a dolní Uložit kategorii sdílejí validaci a ochranu proti opakovanému odeslání. Opravena také situace, kdy obnovení dat mohlo přepsat právě zahájenou další úpravu.

## Ověření

- Chromium a WebKit: deset pracovních sekcí při 320, 390, 767, 768, 1023, 1024 a 1440 px. Bez horizontálního přetečení dokumentu a runtime chyb v těchto scénářích. Desktopové toolbary mají horní souřadnici 20 px a výšku 44 px; jejich rozdíl je v toleranci 1 px.
- Oznámení: běžné kliknutí na Další při 390 × 844 a 320 px, bez force a bez skrývání asistenta.
- Esko: admin, accounting a viewer při 390/1440 px v obou enginech; zachování textu/historie, návrat fokusu, Escape, tabulátor, vnitřní scroll, staré nastavení skrytí, chybová odpověď a dostupný vstup. Prohlížeč může při Tab přenést fokus do svého chrome (document.activeElement je body); na ovládací prvky stránky za dialogem nepřechází.
- Klávesnice: simulované zmenšení visualViewport na 300 px s offsetem 120 px ověřuje viditelnost zavření a vstupu. Nejde o test fyzické klávesnice na skutečném telefonu.
- Upomínky: oba spouštěče při 320/390/1440 px, dvě synchronní kliknutí odešlou jeden požadavek; chyba 503 zachová úpravy, opakování druhým tlačítkem uspěje.
- Faktury: 17 funkčních scénářů a 5 rozměrových kontrol, včetně výběru, řazení, filtrů a exportu na tabletových kartách při 768/1023 px.
- Karty nástěnky: 16 normálních a zátěžových scénářů s dlouhými údaji od 320 do 1440 px.
- Cílené regresní testy: 91/91 v devíti souborech. Lint, typecheck, kontrola whitespace diffu a produkční build úspěšné.

Prohlížečové kontroly používají skutečné React komponenty a CSS s izolovanými syntetickými HTTP odpověďmi. Neprovádějí zápisy do produkce a nenahrazují přihlášené staging E2E ani ověření na fyzickém zařízení.

## Zbývající stav celé sady

Celorepozitářový běh: **2086 úspěšných, 11 neúspěšných testů**. Zůstávají dřívější selhání v sedmi souborech: api-error-identity, customer-invoice-linking (2), customers-ui, destructive-actions, import-ui-regressions (4), dashboard-reminders a payment-matching-workspace. Jde o původní očekávání počtu rout, struktury a textů UI nebo formátu částky. Tato oprava nemění jejich aplikační logiku. Celá sada tedy není zelená.

Při úpravě CSS byl omylem přepsán soubor nástěnky. Obnoven byl z předchozího úspěšného webpack buildu, nikoli ze staršího git HEAD, aby zůstaly zachovány předchozí uživatelské změny. Při obnově bylo porovnáno všech 1661 CSS deklarací; následná úplná kontrola WebKitu a produkční build prošly.

## Podklady

[Původní audit](../design-audit/2026-10-25/AUDIT.md) zůstává zachován. [Galerie po opravě](../design-audit/2026-10-25/fixed/index.html) obsahuje samostatné snímky a měření obou prohlížečů.

Reprodukce:

```sh
node scripts/application-design-audit.mjs --verify-fixes --output=docs/design-audit/2026-10-25/fixed
node scripts/application-design-audit.mjs --webkit --verify-fixes --output=docs/design-audit/2026-10-25/fixed
node scripts/invoices-design-check.mjs
node scripts/dashboard-invoice-cards-check.mjs --revision=design-audit-fixes
npm run typecheck
npm run lint
APP_BASE_URL=https://www.splatno.com npm run build -- .cache/invoices-build
```
