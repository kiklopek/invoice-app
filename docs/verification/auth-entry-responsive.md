# Login, registrace a onboarding — implementace responzivity

2. 11. 2026. Uživatel po auditní fázi výslovně schválil implementaci této rodiny stránek. Změna je lokální, bez nasazení. Ostatní návrhy z auditu se tímto krokem neimplementují.

## Výsledné chování

Karta i vnitřní prvky rostou mírně při dostatečné šířce a výšce. Růst začíná nad 1600 CSS px šířky a 800 px výšky, zastaví se při 2400×1120 px. Další prostor zvětšuje vnější okraje. Obě rozměrové podmínky musí být splněné; široké nízké okno nezíská zbytečně velké ovládání. Karty zůstávají vycentrované; dlouhé formuláře a obsah používají své dosavadní scrollovací oblasti.

| Při 2560×1817                  | Před změnou místního CSS | Po změně     |
| ------------------------------ | ------------------------ | ------------ |
| Login — karta                  | 1440×840 px              | 1760×1000 px |
| Login — nadpis                 | 46 px                    | 54 px        |
| Text v polích                  | 16 px                    | 18 px        |
| Výška pole / hlavního tlačítka | 52 / 56 px               | 60 / 64 px   |
| Registrace — maximální karta   | 1440×960 px              | 1760×1040 px |
| Onboarding — maximální karta   | 1440×1000 px             | 1760×1080 px |

Na 3840×2160 jsou maximální rozměry stejné. Onboarding má samostatně omezený pracovní obsah do 640 px a od 1600 px pevný levý panel kroků 286 px. Sidebar aplikace a workspace nebyly měněny. Mobilní, tabletové a běžné notebookové styly zůstávají podle stejné kompozice jako při zahájení této úpravy.

## Změněné soubory

- [AuthShell CSS](../../src/components/auth/auth-shell.module.css): koordinované šířky, výšky, typografie, ikony, mezery a ilustrace; stejný rám používají login, registrace, MFA, obnova hesla a pozvánky.
- [Onboarding CSS](<../../src/app/(onboarding)/onboarding/onboarding.module.css>): stejná stupnice, vlastní maxima a zachování velikosti levého panelu kroků.
- [Ověření rozložení](../../scripts/entry-layout-check.mjs), [lokální stavové kontroly](../../scripts/responsive-audit/auth-onboarding.mjs) a [generátor galerie / souhrnu](../../scripts/entry-layout-report.py).

Samotná implementace mění pouze dva aplikační CSS soubory. Předchozí místní změny AuthShellu byly zachovány a rozšířeny; ostatních 1890 původních souborů odpovídá kontrolním součtům při zahájení implementace. Auth komponenty, routování, cookies, databáze a API se neměnily. Oddělený [patch pouze tohoto kroku](../../artifacts/entry-layout-2026-11-02/implementation.patch) nezahrnuje starší místní úpravy.

## Ověření a důkazy

- **120 případů před/po** v Chromium a WebKit: login, registrace a onboarding 1/7/8; 390×844, 768×1024, 1440×900, 1920×600, 2560×1817 a 3840×2160. Kontroly přesahů, centrování, dosažitelnosti hlavních akcí a omezeného růstu prošly.
- **30 dvojic snímků** při 390, 768 a 1440 px je byte-shodných s původním místním stavem v obou enginech. Není to schválená produkční MacBook baseline.
- **24 dalších kontrol ve skutečném lokálním Next.js** pro login a registraci v obou enginech. Ověřují také skutečné načtení CSS a Next/font. Prohlížeč nesměl odesílat formuláře ani externí / zápisové požadavky.
- **16 cílených kontrol v Next.js / Chromium** kolem 1599/1600/1601 a 2400 px, při 1920×1080 a různých výškách 2560px okna; bez horizontálního přesahu a s dostupnými tlačítky.
- **8 kontrol zdvojeného textu** na loginu/registraci při 390×844 a 1024×768, v obou enginech. Jde o řízené zdvojení computed fontů a line-height; ovládání zůstalo dosažitelné. Není to fyzická virtuální klávesnice nebo nativní browser zoom.
- **108 stavových případů** na upravených lokálních stylech: všech osm kroků onboardingu, zachování draftu mezi kroky a šířkami, login chyba / zobrazení hesla, registrace s chybným OTP, MFA, obnova hesla, firemní vstup a pozvánky. Všechny zaznamenané kontroly prošly. Krok 2560 px má v tomto běhu výšku 1817 px, takže se kontroluje i Expanded režim.
- **37 existujících testů** v pěti souborech prošlo: login issue, onboarding account switch, onboarding draft, onboarding validace a portrait guard. Nové JavaScriptové kontroly prošly ESLint bez warnings.

[Interaktivní galerie před/po a skutečného Next.js](../../artifacts/entry-layout-2026-11-02/index.html) · [Strojový souhrn a integrita](../../artifacts/entry-layout-2026-11-02/verification.json).

## Opakování a hranice

```sh
node scripts/entry-layout-check.mjs
node scripts/entry-layout-check.mjs --engine=webkit
node scripts/entry-layout-check.mjs --next
node scripts/entry-layout-check.mjs --next --engine=webkit
node scripts/entry-layout-check.mjs --next --curve
node scripts/entry-layout-check.mjs --next --text
node scripts/entry-layout-check.mjs --next --text --engine=webkit
node scripts/responsive-audit/auth-onboarding.mjs --local
node scripts/responsive-audit/auth-onboarding.mjs --local --engine=webkit
python3 scripts/entry-layout-report.py
```

Před/po porovnání používá oddělenou kopii zdrojů pořízenou před implementací v `/tmp/splatno-entry-layout-before`; tato kopie je podkladem konkrétního běhu. `--next` vyžaduje běžící lokální Next.js na portu 3000. Stavový harness má syntetická data i autentizační/API adaptéry. Není to skutečné přihlášení, doručování e-mailu, založení firmy nebo platba. Produkční deployment, skutečné okno MacBooku, fyzické Safari/klávesnice a autentizované serverové stavy nebyly tímto krokem nově ověřeny.

Historický audit a jeho integritní manifest popisují stav před implementací. Nynější oprávněné změny těchto dvou CSS souborů se ověřují vůči novému výchozímu manifestu v tomto kroku, nikoliv označením starého auditu za stále beze změn.
