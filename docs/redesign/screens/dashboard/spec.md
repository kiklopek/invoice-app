# SPL-DASH-001 — implementační mikroplán

## 1. Identita

P05 / DASH-PR01–06, `/dashboard` (R16, ST-045–048 a související shared stavy). Uživatel výslovně zadal implementaci dodaného `SPL-DASH-001-CODEX-PACK.zip`; toto nové zadání povoluje dashboardovou práci i přes předchozí stop bod P00. Neznamená povolení jiných redesignových fází ani push do main. Větev `design-rebuild`.

Přesná dodaná reference je v `reference/SPL-DASH-001-CODEX-SPEC.md`, úplný obrázek `reference/assets/00-full-dashboard.png` a třináct výřezů. Text balíčku označuje stav DESIGN REFERENCE; uživatel nyní zadal její provedení. Konkrétní výklady a odchylky se dokumentují zde. Nevyžadovat znovu souhlas s rutinními prezentačními detaily, které uživatel právě zadal.

## 2. Význam v produktu

Primární úkol: přehled pohledávek a rychlý přechod k fakturám, platbám a plánovaným upomínkám. Role admin/accounting/viewer. Skutečné tenant data, žádné statické osoby/částky z obrázku. Ruční přidání znamená evidovat existující fakturu; nevytváří nový vystavovací proces.

## 3. Baseline a invarianty

| Oblast | Současný kontrakt | Zachovat / ověřit |
| --- | --- | --- |
| Dashboard | RSC `loadDashboardPageData` + SWR `/api/dashboard`, auth/member/role server guards | Žádná změna API/RPC/loaderu, stejné initialData a revalidate-on-revisit. |
| Čeká na úhradu | `active_count` a `open_totals` zahrnují pending **i overdue**, pouze zbývající částky | Výslovný popis; neodečítat overdue z peněžního KPI. |
| Po splatnosti | Serverové `overdue_count`/`overdue_totals` | Nepřepočítávat status z frontendového data. |
| Celkem přijato | `paid_totals` zahrnuje i částečné úhrady | Zůstat u stejného součtu, uvést textem odlišnost od počtu plně zaplacených. |
| Počet všech / zaplacených | Dashboard RPC tyto počty neposkytuje | Použít existující read-only `/api/invoices` a `?status=paid` serverový `total`, nikdy `recent.length`. Nový endpoint ani nový DB součet nevzniká. |
| Graf | Dashboard dosud časový graf neposkytoval; report API již vrací `monthly` | Použít existující `/api/reports` s explicitním from/to/date_basis=issue_date/currency. Popis „podle data vystavení“, nikoli tvrzení cash-flow podle data bankovní úhrady. |
| Donut | Pending a overdue jsou v active_count společně, paid je samostatné | Pending = active − overdue; oddělené paid count; jmenovatel je aktivní + paid, bez stornovaných. „Nejasná platba“ není stav faktury a nevstoupí do součtu. |
| Tabulka | `recent`: poslední přidané faktury, max. 50, nikoli seznam splatností | Zachovat skutečný výběr, název „Poslední faktury“. Zachovat VS, e-mail, reminders count a partial stav. Nevydávat capped list za všechny faktury. |
| Upomínky | `upcoming`: plánované aktivní faktury, max. 50; celkový `reminders_sent` | Zobrazit skutečné plánované položky a počet odeslaných. Nevytvářet globální pause/status automatu bez jeho dat; odkázat do existujícího nastavení podle role. |
| Akce | Import/new/payments/reports/list/detail odkazy; dashboard neměl inline mutation menu | Zachovat všechny; žádné falešné notifikace, pause, tenant switch, cmd-K nebo row menu. Search submit vede do existujícího `/invoices?q=`. |
| Shell | Stejný AppShell a mobilní menu, profile context, role allowlist, logout/confirm a Eško | Nový vzhled omezit na dashboard route; u ostatních rout zachovat stávající prezentaci. Bez druhého profilu. |

Před úpravou browser fixture zachytí skutečné komponenty a CSS se syntetickými daty na desktop/tablet/mobil. Původní `scripts/dashboard-responsive-check.mjs` selhává kvůli neaktuálnímu stubu `revalidate-on-revisit`; nová kontrola používá skutečné hooky/SWR a routuje pouze lokální read-only fixture API. Není to přihlášené Next/Supabase E2E.

## 4. Mapping návrhu a odchylky

Světlý sidebar, profil dole, topbar se skutečným invoice search a původními CTA, uvítání dle skutečného profilu/Prague času, čtyři KPI, dvojice grafů a dvojice seznam/přehled upomínek. Zachovat cestu k párování a reportům. Žádné modelové procento růstu, nesprávná donut kategorie ani fiktivní notifikační badge. Filtr období a měny mění **jen časový graf**, ostatní KPI jsou současný celofiremní stav; toto UI výslovně označí.

## 5. Stavový model

Initial summary je serverově načtené; nové doplňující reads mají vlastní loading/empty/error/retry. Selhání grafu nezahodí původní souhrny a tabulku. Nenačtený údaj není nula. Empty tenant má CTA podle role. Paid count nedostupný znamená nedostupný donut, nikoli vymyšlený počet. Stale summary při revalidation error zůstává s varováním a retry. Velké částky a více měn se nikdy nesčítají bez konverze. Rozměry a role viz acceptance.

## 6. Responsivita a přístupnost

Čtyři KPI na širokém desktopu, dvě dle dostupného prostoru, na úzkém mobilu jeden sloupec. Graf/list ≈ 2/3 a donut/reminders ≈ 1/3, při nedostatku místa jeden sloupec. Mobilní faktury jako karty. Klávesnice/focus, viditelné labels, grafová tabulka pro čtečky, žádný horizontální page overflow. Eško zůstává skutečný panel s Escape/close; plovoucí ovladač nesmí překrývat dolní akce. Přístupné původní mobile menu a logout zůstávají.

## 7. Krokový plán

1. DASH-PR01 audit, specifikace a bezpečná before baseline.
2. DASH-PR02 stávající AppShell s dashboard-only styly a zachovanou navigací.
3. DASH-PR03 hlavička/search/CTA/KPI nad stávajícími read-only zdroji.
4. DASH-PR04 grafy s korektními datasety a vlastními stavy.
5. DASH-PR05 zachovaná recent tabulka a upcoming připomínky, bez nových mutací.
6. DASH-PR06 loading/empty/error/mobile/Eško, interakční testy a screenshoty.

Jde o malé logické části lokální změny; samostatné commity/PR nejsou tímto souborem prohlášeny za vytvořené. Žádný push/merge není součástí aktuálního zadání.

## 8. Testovací scénáře

Unit a komponentní kontrola: žádné odvození count z 50 recent řádků, active zahrnuje overdue, žádné překrytí donut kategorií, currency separation, server total/paid API, epoch/month boundary, nezávislý retry, role CTA a hledání. Browser: skutečné komponenty/CSS v syntetickém Vite harnessu, desktop/tablet/mobile, large data, viewer, empty, report error, keyboard search/menu/Eško a případný overflow. Zdroje backendů nedotčeny; jejich existující testy musí projít.

## 9. Definition of Done

Reference je převedena na skutečné komponenty a data, zachované existující akce, backend/RLS/schema/business bez změny, unit/lint/typecheck/build a bezpečné browser důkazy doložené. Žádné tvrzení o plném produkčním E2E. Aktuální výsledky a mezery patří do acceptance. Celou změnu lze vrátit na předchozí frontend commit; data se nemigrují.

## 10. Výstup

Výsledky, screenshoty, seznam souborů a zbývající rizika: [acceptance.md](acceptance.md). Po dashboardu zastavit, automaticky nezahajovat další podplán ani stránku.
