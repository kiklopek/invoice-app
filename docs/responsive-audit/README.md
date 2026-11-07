# Responzivní audit Splatno — průvodce

## Čtení výstupů

1. `REPORT.md`: nálezy, důkazy, co fungovalo a meze závěrů.
2. `../../RESPONSIVE_DESIGN_SYSTEM.md`: návrh systému a kontrakty komponent.
3. `COVERAGE.md`: přesné pokrytí a chybějící reference.
4. `IMPLEMENTATION_SEQUENCE.md`: následné malé kroky; v této fázi nebyly provedeny.
5. `AUTH_ONBOARDING.md`: podrobná vstupní a onboarding rodina.
6. `../../artifacts/responsive-audit/2026-11-02/index.html`: lokální vizuální galerie porovnávající produkční zdroj a dosavadní pracovní změny.

## Opakování měření

Předpoklady: existující uzamčené závislosti projektu, Playwright prohlížeče a lokálně dostupný git objekt produkčního commitu. Nic se neinstaluje a nemění se aktuální aplikační pracovní strom. `prepare` připraví izolovaný archiv tracked zdrojů a pouze symlink na existující node_modules.

```sh
node scripts/responsive-audit/prepare.mjs
node scripts/responsive-audit/inventory.mjs
node scripts/responsive-audit/run.mjs --matrix
node scripts/responsive-audit/run.mjs --states --states-only
node scripts/responsive-audit/run.mjs --engine=webkit --states
node scripts/responsive-audit/run.mjs --engine=firefox --routes=/invoices,/invoices/create,/customers,/reports
node scripts/responsive-audit/run.mjs --local
node scripts/responsive-audit/interactions.mjs
node scripts/responsive-audit/deep-workflows.mjs
node scripts/responsive-audit/deep-workflows.mjs --processing-only
node scripts/responsive-audit/geometry.mjs
node scripts/responsive-audit/auth-onboarding.mjs
node scripts/responsive-audit/auth-onboarding.mjs --engine=webkit
python3 scripts/responsive-audit/build_auth_report.py
node scripts/responsive-audit/repeatability.mjs
```

Běhy používající tentýž port musí běžet sekvenčně. `--route=/customers` omezuje jednu route, `--routes=/dashboard,/invoices` množinu, `--smoke` tři kontrolní šířky, `--touch` coarse-pointer režimy. `--resume` zachová již změřené případy bez chybějících endpointů; při chybě renderování se runner zastaví. Nemíchat různý zdroj/data/režim do stejného schváleného baseline souboru.

Při opakování první široké matice se mohou přidat nově zahrnuté veřejné/MFA routy; počet staršího doloženého běhu je uložen ve výsledcích, nikoliv odvozován z aktuálního počtu rout v kódu.

## Živá produkce

`node scripts/responsive-audit/production.mjs` zachycuje produkci bez přenosu přihlášení. Volba `--authorized-test-session` je vyhrazená pro výslovně autorizované použití existujícího testovacího přihlášení na téže produkční aplikaci; nepoužívat ji bez odpovídajícího povolení.

V tomto auditu uživatel výslovně povolil tento konkrétní přenos po prvotním zamítnutí automatickou kontrolou. Cookies byly použity pouze v paměti a nebyly uloženy do výstupů. Všechny ne-GET/HEAD požadavky prohlížeče byly blokovány. Stávající session přesto skončila na loginu; audit nevytvářel nové přihlášení a nevyžadoval hesla/tokeny. GET navigace může mít běžné serverové vedlejší efekty, například logování; nejde o garanci absolutně nulových serverových zápisů.

Případné přihlášené screenshoty se ukládají výhradně do ignorované `.cache/responsive-audit/private-production`, nikoliv do sdíleného balíčku. Auth storage, cookies, hesla a HAR/trace s credentials nejsou výstupem auditu.

## Reference MacBooku

Z běžného produkčního okna bez mobilní emulace zjistit `innerWidth`, `innerHeight`, `visualViewport`, DPR a userAgent; dodat také skutečný zoom a displej. Konzole v samostatném okně nesmí měnit pracovní šířku aplikace. Viewport 440×956/iPhone není desktopová reference.

Dodaný rozměr se eviduje nejprve jako `reported`; teprve po zachycení stejného produkčního vzhledu a prostředí lze uzamknout designovou referenci. `1440×900` zůstává diagnostický viewport, dokud skutečné měření neprokáže shodu.

## Schválené screenshotové testy

```sh
corepack pnpm exec playwright test --config scripts/responsive-audit/playwright.config.mjs --list
corepack pnpm exec playwright test --config scripts/responsive-audit/playwright.config.mjs
```

První příkaz pouze ověřuje seznam 12 testů. Druhý má nyní záměrně skončit blokací chybějící schválené reference. Nenastavovat `--update-snapshots`, neobcházet manifest a nevydávat tuto blokaci za pass. `toHaveScreenshot` je připraveno pro explicitně schválené kandidáty ve stejném prostředí; nejde o nyní proběhlé schválení designu.

## Rozhraní a omezení harnessu

- `fixtures.mjs`: kontrolovaná data; žádné produkční hodnoty, služby ani přihlašovací údaje.
- `harness.mjs` + `entry.template.txt`: skutečné komponenty z určeného zdroje; adaptéry Next a syntetické API. Externí browser požadavky jsou v izolovaných bězích blokované.
- Měření obsahuje route, source label, engine, viewport, scenario, pointer režim, render status, geometrii, HTTP výsledky a cestu screenshotu. `measured` není schválení.
- Datum je fixováno pomocí `page.clock.setFixedTime`, běžné časovače běží. Hlubší převzaté OCR/payment kontroly mají vlastní řízené podklady; nejsou všechny pokryty stejným časovým bootstrapem.
- Deep-workflow adaptéry vznikají v cache z existujících testů produkční revize. Výstupy obsahují validační JSON a log. OCR je v těchto testech lokální/syntetické; prostředí neprokazuje skutečného produkčního providera.
- Vite nepředstavuje celý Next.js SSR/production CSS chunking. To je výslovná mez důkazu a důvod nepovyšovat automaticky kandidáty na produkční baseline.

Produktové soubory, existující pracovní změny, databáze a deployment nebyly měněny. Nové soubory tvoří jen dokumentace, auditní/testovací skripty a artefakty.
