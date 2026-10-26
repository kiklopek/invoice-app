# P00 — testovací matice a příkazy

Baseline `f0f5fcb`, 17. 10. 2026. Dokument rozlišuje znovu spuštěné lokální testy, starší důkazy stejného commitu a dosud neprovedené zkoušky. Celý produkční systém není v P00 certifikován jako bezchybný.

## Ověření skutečně provedené v P00

| Příkaz | Výsledek | Co dokládá / mez |
| --- | --- | --- |
| `corepack pnpm test` | exit 0; **198 souborů, 1 701 testů**, 17,44 s | Vitest v `src`; směs doménových, route, komponentních a textových/source testů. |
| `corepack pnpm lint` | exit 0 | ESLint s `--max-warnings 0`. |
| `corepack pnpm typecheck` | exit 0 | `tsc --noEmit`; není runtime E2E. |
| `corepack pnpm check:migrations` | exit 0; **53 migrací** | Kontrola lokálních migračních souborů, nikoli jejich nasazení do Supabase. |
| `node scripts/test-multi-tenant-db.mjs` | exit 0 | PGlite v paměti: tenant guards, exempt, auto-booking policy, support, fair reminder queue. |
| `node scripts/test-payment-assistance-db.mjs` | exit 0 | PGlite: reconciliation/integrity, assistance, CAMT evidence, release permissions a další zahrnuté SQL scénáře. |
| `node scripts/test-organization-onboarding-db.mjs` | exit 0 | PGlite: založení firmy, pozvánky, firemní e-mailová doména a oprávnění. |

Před spuštěním DB runnerů byly ověřeny jejich lokální PGlite importy. Použily existující `.cache/reconciliation-tools/node_modules/@electric-sql/pglite`; žádná instalace ani připojení k produkci. Stručné výpisy příkazů jsou v [evidence/local-checks.txt](evidence/local-checks.txt).

Vitest výpis obsahuje osm upozornění jsdom `Not implemented: navigation to another Document`. Sada přesto prošla; skutečné navigace proto nelze pokládat za ověřené tímto výsledkem a patří do browser testů.

Produkční build stejného commitu prošel už v předchozím release ověření (`/private/tmp/splatno-main-release-build.log`); v P00 se neopakoval. Tento dočasný log není trvalá CI garance ani nový build dokumentace. Vizuální HTML fixture z dřívější práce nejsou přihlášené E2E a nepokrývají všechny stavy této inventury.

## Úplný inventář package příkazů

| Příkaz za `corepack pnpm` | Účel | Prostředí / účinky |
| --- | --- | --- |
| `dev`, `dev:webpack` | Next dev přes clean-env wrapper, webpack | Spouští server a může regenerovat Next typy. Není sám testem. |
| `build` | Produkční Next build, webpack | Potřebuje validní build env dle CI/validátoru. Nelze zaměnit úspěšný placeholder build za funkční backend. |
| `start` | Produkční server | Pro auth E2E se secure cookies vyžaduje odpovídající HTTPS prostředí. |
| `lint`, `typecheck`, `test` | Statika a Vitest | Lokální základ každého relevantního PR. |
| `check:migrations` | Validace pořadí/formátu SQL souborů | Neaplikuje migrace. |
| `validate:env` | Kontrola produkčních env požadavků | Konfiguraci kontrolovat bez vypisování secret hodnot; nenasazuje ji. |
| `audit:ci` | braces security test + dependency audit high | Druhá část vyžaduje registry síť. V P00 znovu neběžela. |
| `test:e2e` | Hlavní Playwright sada | Autentizační bootstrap a potenciální reálné mutace; použít izolovaný staging/test tenant. |
| `check:mobile` | Mobile viewport skript | Před spuštěním přečíst login/setup a cílové URL; není automaticky bezpečný produkční screenshot test. |
| `check:seo` | SEO kontrola | Může vyžadovat běžící server; netestuje skutečnou indexaci Google. |
| `check:domains` | Kontrola doménových SEO variant | Síť/live závislosti; P00 neověřoval DNS ani Google Search Console. |

## Další skutečně existující příkazy a konfigurace

Lokální databázové runnery mimo package scripts:

```sh
node scripts/test-billing-db.mjs
node scripts/test-customer-email-db.mjs
node scripts/test-invoice-total-db.mjs
node scripts/test-multi-tenant-db.mjs
node scripts/test-organization-onboarding-db.mjs
node scripts/test-payment-assistance-db.mjs
node scripts/test-search-db.mjs
```

Používají izolovaný PGlite a lokální SQL testy; potřebují existující tooling cache. V P00 byly spuštěny jen tři výše výslovně označené. `scripts/test-payment-assistance-concurrency.mjs` je samostatný scénář, nikoli náhrada celé živé Postgres concurrency zkoušky; před použitím přečíst jeho setup. SQL testy jsou v `supabase/tests/` a samy se nespustí přes `pnpm test`.

Veřejná browser sada bez workspace global setup:

```sh
corepack pnpm exec playwright test --config=playwright.faq.config.ts
```

Zahrnuje landing FAQ, breakpointy, proces motion, public responsive a mockovanou registraci; neprokazuje reálné odeslání OTP. V P00 nebyla spuštěna. Hlavní `playwright.config.ts` používá `e2e/global-setup.ts`; mimo striktní release režim může při selhání loginu generovat recovery relaci servisním klientem. To není vhodný slepě spuštěný read-only audit produkce.

Release orchestrátor: `scripts/run-release-audit.mjs`, `.github/workflows/release-audit.yml` a související `scripts/validate-release-staging.mjs`, `scripts/assert-release-e2e.mjs`, `scripts/audit-release-database.mjs`, `scripts/build-release-audit.mjs`, `scripts/inventory-release-audit.mjs`. Před použitím ověřit skutečný staging, povolené účty a mutace. V P00 nebyly spuštěny, žádné živé e-maily ani účtování se netestovaly.

## Regresní matice po doménách

| Oblast / R a ST v dokumentu 01 | Existující testy — hlavní zdroje | Povinné rozšíření při změně UI / meze |
| --- | --- | --- |
| Veřejný web, CS/EN, video/process/FAQ | `e2e/landing-{faq,breakpoints,process-motion}.spec.ts`, `public-responsive.spec.ts`, landing source testy | Obě jazykové délky, reduced motion, keyboard video/FAQ, bez overflow; SEO metadata nesmí zmizet. |
| Auth/pozvánka/OTP/recovery | `auth-flow`, `auth-security`, `email-mfa-*`, `verification-code`, `registration-email-server`, invitation route/client testy; `e2e/registration-flow`, `staging-auth` | Zakladatel vs. kolega, pět alfanumerických polí, paste/backspace/resend/expiry/rate limit, session/cookie návrat. Mock signup není skutečný mail flow. |
| Onboarding 1–8 | `company-validation`, `onboarding-*`, `organization-onboarding` a PGlite runner | Dokončené i nedokončené kroky, návrat po loginu, ARES outage, více kolegů, logo error, split výsledky, trial denied a billing návrat. Aktuální E2E nejsou kompletní vizuální pokrytí osmi kroků. |
| Dashboard + shell | `dashboard-*`, role/cache/provider testy; `e2e/smoke`, `navigation-regressions`, `breakpoints` | Empty/data/error, všechny role, menu/focus, banner předplatného/podpory, dirty navigation a logout failure. |
| Faktury CRUD/detail | `invoice-validation`, `invoice-total-*`, route testy, `optional-payment-assignment`; smoke/mobile tables | Výběr textu bez otevření, vysoké částky, úhrada/split, read-only, revision conflict, storno/vrácení, request failure. |
| Dokument/OCR/import | `invoice-ocr-*`, `invoice-isdoc`, `invoice-qr`, `document-validation`; `e2e/document-preview` | PDF/bitmapa, nepovolený obsah, náhled bez úniku cizího souboru, source review, CSV queue, quota/local/AI flag. Nezapínat provider kvůli screenshotu. |
| Platby a GPC | `gpc-*`, `reconciliation-*`, GPC panel test, `payment-assistance-*`, PGlite; `e2e/gpc-import` | Full workspace intro/results, vlastní/cizí účet + ack, duplicates, návrh vs. commit, revision/partial/split, archive/release/discard. Test nesmí zaúčtovat reálný výpis. |
| Zákazníci | `customers-*`, `customer-email-*`, comprehensive search; `e2e/customer-email`, mobile tables | Dlouhá data, kopírování, edit email/phone, potvrzení příjemce, export, nula/mnoho/hledání bez diakritiky. |
| Reporty/tisk | `report-*`; `e2e/report-print` | Všechny čtyři pohledy, měna/období/odběratel, prázdná data, A4 tisk, čitelné grafy bez barev. |
| Firma/tým/support | `settings-page-data`, `company-validation`, bank section testy, `tenant-exclusivity`, `role-authorization`, SQL support | Admin edit vs. účetní read-only, pozvánky, odebírání, role/self-lockout, konflikt verze, draft a ukončení podpory. |
| Automat + šablony | `reminder-*`, logo editor/server/file testy, recipient safety, fairness SQL | Uložení jednoho view nezmění druhé; čtyři stage, reply/CC, logo independent save/checkmark, QR/no bank, unsuppress, potvrzení run/test. Reálné odeslání jen izolovaným příjemcům. |
| Billing | `billing`, `stripe-billing`, PGlite billing | Trial/active/past_due/exempt, perioda, charge confirmation, invalid/duplicate webhook, card return; pouze Stripe test mode. |
| Výstupy | `auth-code-email`, `reminder-email-template`, `email`, `invoice-pdf`, invitations | HTML/text/escaping, fonty a české znaky, logo, QR účet/částka/VS, PDF response headers; inbox sender avatar nelze ověřit DOM screenshotem. |

Názvy s pomlčkou nebo hvězdičkou jsou rodiny testů, ne doslovný příkaz. Přesné existující soubory jsou v `source-inventory.json → tests`; vybírat testy podle změněného kontraktu, ne pouze podle podobnosti názvu.

## Role, rozměry a přístupnost

Pro každé dotčené R/ST ověřit relevantní role **admin/accounting/viewer**, nepřihlášený nebo neúplně ověřený přístup a support podle domény. Ve dvou izolovaných firmách ověřit, že nelze číst/zapisovat cizí ID, dokument ani logo mutaci. UI schování tlačítka není takový test.

Minimální návrhová matice: **320, 360, 390, 480, 768, 820, 1024, 1280, 1440, 1920 px**, nízká výška, landscape a 200% zoom. U skutečně upraveného breakpointu přidat **hranice −1 / hranice / +1 px** podle query v JSON. To jsou navržené akceptační rozměry, nikoli tvrzení, že je dnes všechny automat testuje.

Hlavní Playwright projekty: Desktop Chrome, Desktop Safari/WebKit, tablet 768×1024, Pixel 5, mobile-small 360×740; Firefox se přidává v release auditu. Přepínat okno i za běhu se zachováním formuláře/filtru. Testovat dlouhé názvy a e-maily, hodnoty stovek milionů i limit serverového formátu, empty/loading/error/disabled/conflict, reduced motion, klávesnici, focus a čitelné hlášení chyby. Zákaz scrollu nesmí schovat pole nebo CTA při klávesnici/zoomu; chování má určit schválený návrh.

## CI a brána pro každé budoucí PR

`.github/workflows/ci.yml`: PR + push `main`, lint/typecheck/unit/migrations/audit/build/E2E. Push samotné `design-rebuild` není trigger. `E2E_ALLOW_UNAUTHENTICATED` může povolit přeskočení workspace scénářů bez secrets. Zelená běžná CI tak nemusí být zelená přihlášená regrese.

Release audit workflow vyžaduje explicitní staging login, zakazuje unauthenticated skip a admin recovery, používá nulové retries a kontroluje kritické scénáře. Dostupnost stagingu a těchto secrets nebyla v P00 potvrzena.

Každé implementační PR: přesné R/ST + schválený mockup, testy relevantních nezměněných kontraktů, relevantní browser porovnání stavů a rozměrů, zaznamenané skutečné skipy, žádné nové console/network chyby, popsané riziko/rollback. Neodstraňovat test jen proto, že starý selektor neodpovídá novému UI; nahradit ho odpovídajícím ověřením chování. Source/regex testy nenahrazují přístupnost a vizuální regresi.

## Upřesnění po dodání master plánu

Nová dokumentační aktualizace neměnila aplikační baseline a neopakovala testovací příkazy; výše uvedené výsledky patří předchozímu kroku stejné P00. Master D.5 nově výslovně vyžaduje bezpečnou aktuální screenshotovou baseline — její neprovedení je B06 a stav capture BL01–BL06 je v `phases/P00-audit.md`. Build není nově tvrzen jako spuštěný. Předchozí kritické E2E zůstávají plánem, ne výsledkem.

Doplnit testy celé sekvence P18: founder register → draft/onboard → OCR review/save → GPC review/commit → paid invoice → report; schedule/test/pause; invitation → RBAC; trial → checkout callback pouze sandbox. Cross-screen porovnat paid/open receivables, zastavení upomínek a historii. Konkrétní live fixture účet ani poskytovatel sandbox nebyl v P00 nově vytvořen.
