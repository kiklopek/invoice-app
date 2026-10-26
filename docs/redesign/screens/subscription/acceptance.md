# Předplatné — implementační report, 23. 10. 2026

## Výsledek a hranice ověření

Stránka `/predplatne` je přepracovaná podle dodaného mockupu ve stávajícím
AppFrame/AppShellu. Navigace Nastavení → Předplatné už existovala a zůstala
zachovaná; sdílené pozadí, topbar, profil a Eško nejsou kopírovány.
Implementace je lokální, bez commitu, pushnutí, nasazení, změny produkčního
Stripe nebo aplikace migrace na vzdálenou databázi.

Platební funkce jsou napojené na existující Stripe integraci, nikoli na
produkční placeholdery. V místním `.env.local` není nakonfigurovaný Stripe
secret key. Proto nejde prohlásit skutečné Stripe sandbox E2E za ověřené.
Před ostrým nasazením zůstává nutná kontrola v izolovaném účtu Stripe.
Testovací karetní údaje a stavové scénáře níže existují výhradně ve fixtures.

## Funkčnost

- Aktuální tarif, trial, zbývající dny, zrušení ke konci období, naplánované
  změny, ukončené/neúplné/pozastavené předplatné a trvalý přístup.
- Nabídka se čte z PLANS: Start, Profi a Business. Ceny bez DPH jsou stále
  790, 1590 a 2990 Kč/měsíc; ročně deset měsíčních cen. Měsíční přepínač
  mění pouze nabídku, neposílá žádnou finanční mutaci.
- Aktuální cena vychází z konkrétní Stripe subscription/invoice preview;
  příští platba je zřetelně označená jako odhad. Ceník nenahrazuje individuální
  cenu, slevu ani daň. Neznámý individuální tarif není vydáván za neaktivní.
- Náhled změny používá Stripe pro doplatek i odhad pravidelné platby, včetně
  slev a daní. Downgrade dál platí až od dalšího období. Předčasné ukončení
  trialu má nový čtecí náhled aktuální částky z brány.
- Nativní potvrzovací dialogy před změnou/zrušením/aktivací. Žádná úspěšná
  návratová URL sama neaktivuje předplatné: ověřuje se setup session na serveru.
  Pending není zobrazen jako úspěch. Každé načítání má konečný timeout.
- Karta: pouze značka, poslední čtyři číslice a expirace. Změna karty a úplná
  historie používají existující hostovaný Stripe portal. Stránka čte posledních
  deset dokladů firmy včetně hostovaného PDF/odkazu.
- Využití má skutečné firemní počty a žádný procentuální progress vůči nekonečnu.
  Faktury používají skutečné quota počítadlo; ostatní metriky jsou informační,
  bez vymyšlených číselných limitů.
- Chybějící předplatné může vstoupit do stávajícího card setup flow; bezpečný
  upsert vytváří jen chybějící řádek a nepřepisuje souběžně založené předplatné.
- Paused/unpaid/incomplete subscription s existujícím Stripe ID nevytváří druhé
  předplatné, ale nabízí správu původního přes Stripe. Neznámé individuální
  ceny se nemění katalogovou operací naslepo.

## Backend, bezpečnost a migrace

Žádné nové API endpointy ani duplicitní billing systém.

| Operace | Změna |
| --- | --- |
| GET /api/billing | Volitelné `details=1`: sanitizovaná provider metadata a využití. Původní lehké čtení pro banner/onboarding zachováno. Chyba DB se neprezentuje jako aktivní předplatné. |
| POST /api/billing/subscription | Nový read-only `preview_end_trial`; ostatní akce zachovány. Přenos idempotency key do Stripe a strukturované záznamy akcí bez karetních tajemství. |
| Stripe služby | Ověření přiřazení subscription/customer/firmy, validace katalogových cen/currency/interval, ochrana opakované aktivace přes odlišné checkout sessions. |
| Limity faktur | API preflight a autoritativní DB trigger; kód chyby monthly_invoice_limit s HTTP 402. |

Oprávnění: firma vždy pochází z getRequestIdentity, ne z klientského company_id.
Karta/historie a všechny mutace pouze admin (canManageMembers). Účetní má
zachovaný základní přehled tarifu a využití. Citlivá metadata se nepředávají
neoprávněným rolím. Mutace kontrolují origin. Cache-Control je private,no-store.
Provider odpovědi jsou zúžené; nevrací se číslo karty, CVV, fingerprint, secret
nebo zákaznické ID. Žádný nový secret není použit v klientském bundle.

Migrace: `supabase/migrations/20261022221912_subscription_monthly_usage.sql`.
Důvod a kompatibilita jsou v [auditu](audit.md), zapsaném před implementací.
Přidává dva sloupce do existující subscriptions; žádnou novou tabulku.
Start má 100, Profi 500 faktur za kalendářní měsíc UTC, Business bez limitu.
Započítává se každé uložení/INSERT, ne jen otevřené či neuhrazené doklady.
Smazání kapacitu nevrací, archivace/uhrazení ji nemění. Nový měsíc se resetuje
při prvním INSERT. Trial má nadále nezávislý celkový trial limit; jeho faktury
současně vstupují do měsíčního počtu. Přechod z trialu měsíční spotřebu neresetuje.
Firmy billing_exempt nejsou limitované. Zámek subscriptions serializuje zápisy;
konkurence nespoléhá na frontendové progress bary. Backfill zahrne všechny
existující faktury aktuálního měsíce; historicky smazané nelze rekonstruovat.
Index invoices_org_created už existuje a backfill nevyžaduje další index.

Privilegovaná trigger funkce zůstává neveřejná a aplikace nenabízí endpoint
pro nastavení spotřeby. Migrace se musí nasadit před serverovou částí. Bez
nových sloupců je neznámá metrika v UI označena jako nedostupná, nikoli jako nula.
Aktivace měsíčních limitů mění dosavadní nevynucování placených limitů a musí
být zahrnuta do plánovaného nasazení, včetně kontroly firem nad kvótou.

Webhooky dál ověřují Stripe podpis, znovu čtou aktuální subscription, evidují
události až po úspěchu a používají stávající ochranu proti staršímu zrcadlení.
Žádné přímé nastavování active z browseru. Finanční timeout nepředstírá, že
se určitě nic nestrhlo; UI žádá obnovení skutečného stavu.

## Ověření

- 103 Vitest testů ve 12 souborech: stránka, tarifní konfigurace, actual pricing,
  slevy, limity, read/write API, role/firmy, billing engine a webhook regrese.
- `node scripts/test-billing-db.mjs`: izolovaný PGlite PostgreSQL, replay všech
  migrací a SQL regresí trialu, placených měsíčních limitů, obnovení měsíce,
  smazání faktury a trvalého přístupu. Žádná vzdálená DB nebyla změněna.
- 23 Chromium scénářů: šest viewportů, interval, potvrzení a jeho zrušení,
  změna tarifu, zrušení/obnovení, portál, chyba/retry, stavy a návrat z brány.
  Používá skutečný AppShell/SubscriptionClient a interceptované syntetické API.
- TypeScript, cílený ESLint a izolovaný webpack production build.
- Ručně zkontrolovaný screenshot desktopu a mobilu. Struktura odpovídá
  referenci; názvy/ceny/funkce jsou správně z aplikace a historie je navíc
  pod spodními kartami. Nejde o pixelový diff ani živou finanční transakci.

## Screenshoty a běh testů

Výsledky: [validation.json](../../visual-validation/subscription/validation.json).

- [1536 × 1024](../../visual-validation/subscription/subscription-1536x1024.png)
- [1440 × 900](../../visual-validation/subscription/subscription-1440x900.png)
- [1280 × 800](../../visual-validation/subscription/subscription-1280x800.png)
- [768 × 1024](../../visual-validation/subscription/subscription-768x1024.png)
- [390 × 844](../../visual-validation/subscription/subscription-390x844.png)
- [320 × 568](../../visual-validation/subscription/subscription-320x568.png)

Další stavové screenshoty jsou ve stejném adresáři.

Příkazy:

```sh
node node_modules/vitest/vitest.mjs run \
 'src/app/(workspace)/predplatne/subscription-client.test.tsx' \
 src/lib/subscription-details-server.test.ts src/lib/billing-server.test.ts \
 src/lib/plans.test.ts src/lib/billing.test.ts src/lib/stripe-billing.test.ts \
 src/app/api/billing src/app/api/invoices/route.test.ts \
 src/lib/role-authorization.test.ts src/lib/api-route-contract.test.ts
node scripts/test-billing-db.mjs
node scripts/subscription-design-check.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
APP_BASE_URL=https://www.splatno.com node scripts/next-clean-env.mjs build .cache/invoices-build --webpack
```

## Seznam souborů a komponent

Frontend:

- `src/app/(workspace)/predplatne/subscription-client.tsx` — upravená komponenta
  SubscriptionClient s aktuálním tarifem, nabídkou, využitím, kartou a historií.
  Používá existující AppFrame, Icon a confirmAction. Další AppShell nevznikl.
- `src/app/(workspace)/predplatne/predplatne.module.css` — vzhled a responzivita.
- `src/app/(workspace)/predplatne/subscription-client.test.tsx` — nové regrese UI.
- `src/lib/subscription-view.ts` — společný bezpečný prezentační kontrakt.

Server a konfigurace:

- `src/app/api/billing/route.ts`, `src/app/api/billing/route.test.ts`
- `src/app/api/billing/subscription/route.ts`, `src/app/api/billing/subscription/route.test.ts`
- `src/lib/subscription-details-server.ts`, `src/lib/subscription-details-server.test.ts`
- `src/lib/billing-server.ts`, `src/lib/billing-server.test.ts`
- `src/lib/stripe-billing.ts`, `src/lib/stripe-billing.test.ts`, `src/lib/stripe.ts`
- `src/lib/plans.ts`, `src/lib/plans.test.ts`, `src/types/database.ts`
- výše uvedená SQL migrace a `supabase/tests/subscription_monthly_usage.sql`

Nástroje a dokumentace:

- `scripts/test-billing-db.mjs`
- `scripts/subscription-design-check.mjs`, `scripts/subscription-design-fixtures.mjs`
- `docs/redesign/screens/subscription/audit.md`, tento report
- `docs/redesign/visual-validation/subscription/*`

## Zbývá před produkčním dokončením

1. Bezpečně nakonfigurovat oddělený Stripe sandbox, šest lookup prices podle
   stávajícího stripe-setup skriptu, daňovou sazbu podle skutečného plátcovství,
   webhook secret a hostovaný portal umožňující požadované operace.
2. V sandboxu ověřit skutečné Checkout → webhook → subscription, 3DS,
   individuální slevy, upgrade/downgrade, zrušení/obnovení a portál. Dosud
   byly tyto větve ověřené mockovaným SDK/API, nikoli skutečným Stripe účtem.
3. Při samostatně autorizovaném nasazení aplikovat připravenou migraci a
   prověřit aktuální spotřebu placených firem; následně nasadit server/UI.
4. Finanční operace neověřovat reálným strháváním plateb na produkci.

Dokud neproběhne sandbox ověření a nasazení, není tímto reportem prohlášena
živá platební integrace za dokončenou. Všechny produkční hodnoty zobrazené
novým kódem jsou odvozené ze skutečné konfigurace nebo serverových dat;
mockupové hodnoty nejsou použité jako údaje zákazníka.
