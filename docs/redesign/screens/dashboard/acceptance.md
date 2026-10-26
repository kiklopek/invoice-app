# SPL-DASH-001 — implementace a ověření

> Historický záznam první implementace. Aktuální single-screen doplnění, výsledky a screenshoty: [refinement.md](refinement.md) a [refinement-verification.json](refinement-verification.json).

Dashboard je lokálně implementovaný ve větvi `design-rebuild`; nic se necommitovalo ani nepushovalo do main. Vizuální revize uživatelem ještě neproběhla. Přesná dodaná reference je v `reference/`; chování vychází z aplikace, nikoli modelových částek na obrázku.

## Implementované části

| Pack | Výsledek |
| --- | --- |
| CMP-01/12 | Světlý sidebar, ribbon značka, profil pouze dole, původní tenant/role/navigace/logout a mobilní menu. Vlastní logo firmy na desktop dashboardu zůstává u spodního profilu; jinde původní umístění. |
| CMP-02/03 | Funkční hledání do `/invoices?q=`, původní import/ruční přidání podle role, aktuální jméno a Prague datum/pozdrav. Bez druhého profilu a neexistujících notifikací/cmd-K. |
| CMP-04–07 | Čtyři KPI, serverové počty a původní peněžní souhrny. Nenačtená hodnota má skeleton/error, nikoli falešnou nulu. |
| CMP-08/09 | Skutečný report graf s měnou/obdobím a tabulkovou alternativou, disjunktní status donut. Nejasné bankovní platby jsou samostatný odkaz pro oprávněnou roli. |
| CMP-10/11 | Původní poslední faktury, VS/e-mail/partial/upomínky, tabulka nebo mobilní karta; kopírování bez otevření detailu. Skutečný seznam plánovaných upomínek a celkový počet odeslaných. |
| CMP-13 | Původní Eško chat s malým plovoucím kruhem, Escape/close; při mobilním menu skrytý, aby nekolidoval s dialogem. |

CSS a nový vzhled shellu jsou omezené na dashboard; backend/API/auth/RLS/schema/OCR/matching/reminder/billing pravidla se nemění. Sdílené ikony dostaly pouze vyhledávací symbol. Změněné soubory a hashe jsou ve `verification.json`.

## Odchylky od ilustračního obrázku

- Čekající KPI zahrnuje overdue i částečně uhrazené, stejně jako původní `active_count/open_totals`. Paid count je počet úplných úhrad, peněžní součet přijatého obsahuje i partial úhrady; UI to vysvětluje.
- Žádná statická osoba, čísla či modelové procento růstu nejsou v produkční komponentě. Fixture firmy existují jen v testech.
- Graf „Faktury v čase“ zobrazuje původní report definici podle měsíce **vystavení**, nevydává ji za bankovní cash-flow. Období/měna mění jen graf, KPI jsou současný celofiremní stav.
- Tabulka se jmenuje „Poslední faktury“, protože zachovává `recent` a jeho pořadí/limit. Donut neobsahuje nejasnou platbu jako stav faktury; procenta mají společný základ a jsou zaokrouhlená.
- Upomínky zůstávají v původní navigaci pod Nastavením. Nevzniká fiktivní pause, řádkové mutační menu, zvonek ani přepínání tenantů.

## Výsledky

| Příkaz / kontrola | Doložený výsledek |
| --- | --- |
| `corepack pnpm test` | 200 souborů / **1 714 testů prošlo** |
| `corepack pnpm lint` | Prošlo, 0 warnings |
| `corepack pnpm typecheck` | Prošlo |
| Produkční Next build | Prošlo v izolované kopii, se syntetickou release konfigurací; původní `.next`/localhost se nepřepisoval |
| `node scripts/dashboard-design-check.mjs` | 32 Chromium scénářů/rozměrů prošlo |
| `node scripts/dashboard-design-check.mjs --webkit` | 32 WebKit scénářů/rozměrů prošlo; viz `verification.json` a engine results |
| Before baseline | 3 snímky skutečných původních komponent/CSS se syntetickými daty |

Celá sada zkouší serverové counts místo capped list length, matematiku donut kategorií, měnové oddělení, datumové hranice, retry, viewer guard, neztracené sekce při chybě grafu a kopírování. Původní statické testy odstraněného layoutu byly nahrazeny relevantními kontrolami a skutečnými komponentními/interakčními scénáři, nikoli přeskočeny.

První build nemohl stáhnout Google fonty v sandboxu; síťově povolený izolovaný build pak prošel. Do izolované kopie bylo nutné přidat E2E soubory importované kořenovou Playwright konfigurací. WebKit fixture nyní čeká na dokončení fetch před další dokumentovou navigací, aby očekávané rušení requestů nepovažoval za CORS chybu. Produkční kód se kvůli těmto tooling problémům neměnil.

## Screenshoty

- [Desktop po změně](../../../../artifacts/dashboard-design/after-chromium/normal-1440.png)
- [Tablet po změně](../../../../artifacts/dashboard-design/after-chromium/normal-820.png)
- [Mobil po změně](../../../../artifacts/dashboard-design/after-chromium/normal-390.png)
- [Původní desktop](../../../../artifacts/dashboard-design/before-chromium/normal-1440.png)

Výsledky/ostatní scénáře jsou v `artifacts/dashboard-design/`. Šířky běžného stavu: **320/375/390/430/599/600/767/768/820/844 landscape/899/900/1023/1024/1199/1200/1279/1280/1440/1600**. Prázdná firma, viewer, velké částky/dlouhá data a report error jsou navíc na 1440/820/390. Ověřuje se search, shell mimo dashboard, Eško/mobile menu a Escape, absence page overflow a neočekávaných požadavků. Snímky mají status `implemented-fixture`, nikoli schválení uživatelem.

Runner potřebuje lokální port a Playwright browsery, používá již přítomný Vite z Vitestu. Nečte `.env` ani Next auth bootstrap a blokuje externí síť/všechny API mutace. `--before` po implementaci nesmí přepsat původní baseline.

## Meze a rizika

Browser harness vykresluje skutečné React komponenty/CSS, ale adaptuje Next Link/router/image a vrací syntetické HTTP odpovědi. **Není to přihlášené Next/Supabase E2E** a neověřuje nové přihlášení, živé RLS/doručení/Stripe. Backend se nemění. Jsdom nadále obsahuje osm původních upozornění o neimplementované dokumentové navigaci; skutečné nové interakce se kontrolují browserem.

Přibyly tři paralelní read-only dotazy na existující invoice/paid/report endpointy. Jejich reálnou latenci a konzistenci při souběžných změnách je vhodné ověřit ve stagingu; loading/failure zůstává v příslušném doplňujícím panelu. Žádný účetní zápis se nepřesouvá. Úplný WCAG audit, screen reader a skutečný browser zoom 200 % nejsou prohlášeny za hotové.

Globální P00 baseline všech 28 rout zůstává otevřená; zde je doplněný pouze dashboard. Samostatné GitHub PR/commity/deployment nevznikly. Rollback znamená vrátit tuto frontendovou změnu; databázový rollback není třeba. Po dashboardu se automaticky nezačíná další obrazovka.
