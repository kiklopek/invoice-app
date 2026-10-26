# P00 — auditní report

Audit zdrojů k 17. 10. 2026, větev `design-rebuild`, commit `f0f5fcb`. Výstupem je pouze dokumentace. Oba plánovací podklady jsou nyní dodané, přečtené a přesně zkopírované; redesign nebyl zahájen. P00 čeká na bezpečnou aktuální screenshotovou baseline a uživatelskou revizi.

## Zjištěná architektura

Next.js **16.3.8 App Router**, React **19.2.8**, TypeScript **6.0.2**, pnpm **10.12.4**, Node nejméně 22; CI používá 24. Při další implementaci platí lokální dokumentace Next v `node_modules/next/dist/docs/`, nikoli předpoklady ze starších verzí.

Zdroj obsahuje **28 stránek**, **64 API rout** a **4 další route handlery**. Úplná inventura obsahuje **105 UI TSX souborů bez testů**, **21 CSS souborů**, **20 layoutů/loading/error hranic**, **198 zdrojových testovacích souborů**, **15 Playwright spec souborů** a **53 migrací**. Počet stránek není počet návrhů: onboarding má osm kroků, reporty čtyři pohledy a všechny pracovní toky mají dialogy a chybové stavy.

Serverové stránky zpravidla načítají počáteční data přes `*-page-data.ts`, klientské části používají SWR a `apiFetch`. Některé stránky (import, nový doklad, archiv, část auth) jsou přímo klientské. Firemní identitu a oprávnění hlídá více vrstev: proxy → serverový layout → API → databázové/RLS a RPC kontroly. UI context s rolí není bezpečnostní hranice.

## Nálezy a priorita

Priority zde určují pořadí dalšího ověřování a přípravy redesignu; nejsou tvrzením o nově potvrzeném produkčním incidentu.

| ID / priorita | Důkaz a dopad | Co udělat před implementací |
| --- | --- | --- |
| A01 / vyřešeno | Master plán a phase template dodány a přesně zkopírovány, jejich původ/hashes evidovány. | Fáze P01–P18 již přiřazeny v 06; P00 ještě potřebuje baseline a review. |
| A02 / P0 schválení | Master deklaruje schválené návrhy některých obrazovek; jejich přesné soubory/frame/verze ale nejsou přiloženy. Registr M01–M21 odděluje deklaraci od dostupnosti. Historické screenshoty nejsou novým návrhem. | Navázat PR na přesné R/ST položky a schválené návrhy. |
| A03 / P1 styly | `minimal.css`: 4 215 řádků / 293 výskytů `!important`; `responsive.css`: 2 105 / 193. K tomu globální pravidla, moduly a lokální styly. | Pro každý PR určit vlastníka selektorů a otestovat sousední stránky i breakpointy; nepřehodit celou kaskádu naráz. |
| A04 / P1 vazby | `RemindersClient` obsluhuje `/reminders` i `/settings/email-template`; společný versionovaný PUT obsahuje harmonogram i texty. Logo má vlastní okamžitý save. | Oddělit v návrhu prezentaci od existujících kontraktů. Ověřit, že změna jedné stránky nesmaže data druhé. |
| A05 / P1 ověření | Standardní CI dovoluje unauthenticated skips bez login secrets; E2E bootstrap může mimo release režim použít admin recovery. | Před implementačním PR připravit izolovaný staging, role a striktní release sadu bez skip/recovery. |
| A06 / P1 bezpečnost | OCR, párování, zakládání firmy, odesílání e-mailů a billing mají nezávislé validace, revize, role a externí vedlejší účinky. | Zachovat kontrakty z dokumentu 03; testovat nad izolovanými účty a daty. |
| A07 / P1 prostředí | V předchozí práci nebyla v produkci aplikována migrace `20261012233239_comprehensive_search.sql`; aplikace má fallback. P00 stav produkce znovu neověřoval. | Samostatně ověřit drift migrací před funkčními změnami hledání. Neaplikovat DDL v redesignovém PR. |
| A08 / P2 rozpor | Historický brief zakazuje CSS Modules, tvrdí pouze české rozhraní a chybějící 404. Dnes existují moduly, `/en`, auth překlady i vlastní `not-found.tsx`. | Aktualizovat specifikaci podle skutečnosti; starý brief nepoužívat jako aktuální akceptační seznam. |
| A09 / P2 údržba | `settings-tabs.tsx` má starý společný název, ale nebyl nalezen jeho import. Živá navigace má nové rozdělení. | Evidovat jako zřejmě nepoužitou komponentu, nehlásit bez důkazu jako viditelný bug; neodstraňovat v P00. |
| A10 / P2 rozsah | `gpc-import-panel.tsx` 1 208 řádků, `reminders-client.tsx` 1 128, `invoice-detail-client.tsx` 1 075, onboarding klient 968. | Malá PR podle jednotlivých stavů, případné extrakce samostatně bez vizuálních změn. |
| A11 / P2 CI | CI běží na PR a push do `main`; samotný push `design-rebuild` ho nespustí. Nastavení GitHub branch protection nebylo ověřeno. | Další práci kontrolovat přes PR. Případnou ochranu větví řešit zvlášť. |

## Co je ověřeno

V P00 znovu prošel lint, TypeScript, **1 701 testů / 198 souborů**, kontrola **53 migrací** a tři izolované PGlite DB runnery pro tenanty, zakládání firmy a párování. Podrobnosti, příkazy a meze: [05-testing-matrix.md](05-testing-matrix.md).

Produkční build má úspěšný výsledek z předchozího ověření stejného commitu, v P00 nebyl znovu spuštěn. Nové screenshoty, kompletní přihlášené E2E, produkční RLS, DNS/BIMI, doručitelnost a skutečné Stripe platby nejsou tímto auditem ověřeny. Zelené unit testy nejsou důkaz kompletní vizuální regrese ani produkční autorizace.

## První bezpečné PR

**Návrh: `docs: P00 inventory and contract baseline`.** Pouze `docs/redesign/**`, bez závislostí, CSS, API nebo migrací. Originály masteru/template jsou přiložené; inventura porovnána s routami, přesné verze mockupů a baseline zůstávají otevřené. Tento lokální balíček je jeho konkrétní připravený obsah, zatím necommitnutý a neodeslaný.

První navazující implementační PR je podle dodaného plánu P01.A: omezený základ sémantických tokenů po schválení konkrétní specifikace; P04 připraví bezpečné testové fixtures. Není to automatické povolení pokračovat. P00 ještě potřebuje B06/B07. Podrobný rozpad všech oficiálních fází a skutečný stav mockupů obsahuje 06 a mockup-register.

## Doplnění po dodání master plánu

Nově zjištěné rozdíly jsou [C01–C08](02-design-contract.md): zejména záporné částky versus současná validace, CSV partial success versus atomická dávka, neexistující role owner/member a chybějící aktuální P00 screenshoty. Dotčené kroky nejsou řešeny změnou kódu. P00 nepovažovat za plně přijatou pouze díky dodání dokumentů.
