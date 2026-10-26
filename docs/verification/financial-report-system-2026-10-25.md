# Finanční PDF reporty Splatno — implementace a ověření

Aktualizace stránkování 26. 10. 2026: na přání uživatele začíná každá hlavní kapitola a samostatný detailní přehled na nové stránce, také v souhrnném a detailním režimu. Standardní syntetická ukázka nyní má 13 stran kompletních, 11 detailních a 4 souhrnné. Původní cílové rozsahy níže jsou historické. Prošlo 13 PDF testů včetně samostatných začátků kapitol ve všech čtyřech režimech, typecheck a cílený lint; souhrnný i detailní dokument byl znovu vizuálně zkontrolován. Podpoložky jedné kapitoly (například legendy grafů a definice v metodice) zůstávají v dané kapitole.

Aktualizace 26. 10. 2026: po výslovném souhlasu uživatele nasazena databázová migrace `20261026101041_financial_report_snapshot.sql`. Živá kontrola přes RPC API a PDF renderer prošla: 47 faktur, úplný snapshot, platné PDF s 19 stranami. Podrobnosti v `report-pdf-loading-fix-2026-10-26.md`. Níže je původní stav ověření před nasazením.

Datum: 25.–26. 10. 2026. Implementace v pracovním stromu; bez nasazení a bez spuštění migrace v produkci. Všechny zveřejněné ukázky používají syntetická data.

## Výsledek

V Reportech je společný exportní dialog pro tržby, DPH, pohledávky a zpracování bankovních výpisů. Uživatel zvolí rozsah, vytvoří skutečné PDF, prohlédne si jeho stránky a stejný soubor stáhne nebo předá tiskové funkci prohlížeče. Samotné dashboardy se tímto úkolem nepřestavují.

## 1. Změněné a nové soubory

Nové produkční soubory:

- `src/lib/financial-report.ts`: sdílené typy, konfigurace, metodika, přesné formátování peněz.
- `src/lib/financial-report-server.ts`: autorizované načtení a kontrola úplnosti snapshotu.
- `src/lib/financial-report-drawing.ts`: společný dokumentový design a stránkování.
- `src/lib/financial-report-pdf.ts`: kompozice čtyř oblastí a čtyř režimů.
- `src/app/api/reports/pdf/route.ts`: autorizovaný POST vracející PDF.
- `src/components/financial-report/financial-report-export.tsx` a `.module.css`: export, konfigurace a životní cyklus PDF.
- `supabase/migrations/20261026101041_financial_report_snapshot.sql`: databázový snapshot a oprávnění.

Úzce dotčené existující soubory:

- `src/app/(workspace)/reports/reports-client.tsx`: napojení společného exportu na aktivní filtry; odstranění aktivního vykreslování samostatné HTML tiskové sestavy.
- `src/components/document-preview.tsx`: volitelný kontext reportu, původní OCR chování zachováno.
- `src/types/database.ts`: typ nové RPC.
- `next.config.js`: zahrnutí existujících fontů a značky do serverového balíčku PDF endpointu.
- `src/lib/report-print.test.ts`: aktualizované integrační očekávání nového exportu.

Ověřovací soubory:

- `src/lib/financial-report.test.ts`, `src/app/api/reports/pdf/route.test.ts`.
- `src/test/financial-report-fixtures.ts`, `supabase/tests/financial_report.sql`.
- `scripts/test-financial-report-db.mjs`, `scripts/financial-report-preview.mjs`, `scripts/financial-report-check.mjs`.
- Artefakty v `docs/redesign/visual-validation/financial-reports/`.

Pracovní strom již obsahoval rozsáhlé změny z předchozích úkolů. Tento seznam popisuje finanční export, nikoli celý rozdíl proti HEAD.

## 2. Sdílené dokumentové komponenty

`ReportDrawing` poskytuje A4 stránku, kompaktní záhlaví, skutečné číslování a patičku, odstavce, oddělovače, informační poznámky, KPI, tabulky s opakovaným záhlavím, sloupcové grafy, donut a vodorovné přehledy pohledávek. Všechny sestavy používají stejnou typografii, okraje a barevnost.

Použity jsou bílé stránky, jemné zelené plochy, tenké linky, české popisky a přesné částky. Čísla nejsou závislá na barvě; grafy mají popsané série a legendy. Podrobné tabulky nezkracují peněžní částky na tisíce či miliony.

## 3. Vykreslovací technologie

Použita je již instalovaná kombinace `pdf-lib` + `@pdf-lib/fontkit`, bez nové produkční závislosti a bez serverového prohlížeče. Font Liberation Sans je vložen do PDF včetně české diakritiky. Grafy a tabulky jsou vektorové. Nejde o snímky webového dashboardu.

## 4. Datová architektura a finanční přesnost

`POST /api/reports/pdf` ověří identitu a filtry, jednou zavolá `financial_report_snapshot`, z výsledku sestaví model a vykreslí PDF v paměti.

Snapshot používá stávající `invoice_report_summary` a `payment_reconciliation_summary`. Přidává úplné vybrané faktury, rozpad podle zákazníků a všechny vybrané zaúčtované výpisy. Vzorce existujících souhrnů se nemění. Tři existující pouze čtecí funkce jsou označeny `STABLE`, aby spolu s novou funkcí používaly snapshot volajícího SQL příkazu; to odpovídá [pravidlům snapshotů PostgreSQL](https://www.postgresql.org/docs/current/xfunc-volatility.html).

Součty peněz a agregace DPH, stáří pohledávek a zákazníků se pro tisk přenášejí také jako desetinné řetězce. Formátování využívá celočíselnou část přes `BigInt`, aby velké součty neztratily haléře převodem na JavaScript `number`. Čísla pro poměry a geometrii grafů používají číselnou projekci; přesné údaje zůstávají v textu a tabulkách.

Zachovány a vysvětleny jsou stávající významy:

- Fakturace může podle zvoleného filtru zahrnovat storna. KPI evidovaných úhrad storna vylučuje, zatímco stávající měsíční přehled úhrad může obsahovat i úhrady těchto dokladů; report tuto odlišnost přiznává.
- Pohledávky jsou současné zbývající částky po částečných úhradách, nikoli rekonstrukce historického stavu. Stáří vychází z aktuálního data v Praze.
- DPH používá existující evidované základy a daň, včetně uloženého rozpadu více sazeb nových faktur. U starších dokladů se nepředstírá rozlišení režimů, které data neobsahují.
- DPH není daňové přiznání, neobsahuje odpočty a nemá nově vymyšlený filtr DUZP.
- Bankovní část popisuje počty a posouzení, nikoli peněžní cash flow. Zahrnuje celou firmu a všechny měny; zákaznické, měnové a stavové filtry faktur ji neomezují.
- Období výpisů používá datum zaúčtování importu v `Europe/Prague`; nespárované platby jejich bankovní datum. Bezpečný návrh neznamená automatické zaúčtování.

## 5. Režimy exportu

| Režim | Obsah | Ověřená malá ukázka |
| --- | --- | --- |
| Souhrnný | Hlavní KPI, vybrané grafy a stručná metodika; bez registru faktur | 2 strany |
| Detailní | Souhrny, zákazníci, rozpad DPH, pohledávky a bankovní zpracování, vybrané detaily | 6 stran |
| Kompletní | Dvanáct standardních kapitol, pokračování podle skutečných dat | 12 stran |
| Vlastní | Zvolené oblasti, grafy, detaily, zákazníci, období, měna a existující filtry | 10 stran v ukázce DPH + platby na šířku |

Počet stran není smluvně pevný: více záznamů či delší názvy vytvoří další stránky. Režim bez záznamů má jednu informativní stránku. Volba přísného dvanáctistránkového maxima se nenabízí.

## 6. Standardní kapitoly kompletního reportu

1. Finanční report — titulní strana s firmou a rozsahem.
2. Přehled tržeb — KPI a měsíční vývoj.
3. Největší odběratelé — fakturace, úhrady, podíl a počet dokladů.
4. Detailní přehled faktur — všechny odpovídající doklady.
5. Přehled DPH — KPI, sazby, součty a podíl.
6. Detailní přehled DPH — doklady a jejich sazby.
7. Přehled pohledávek — zbývající částky a stávající intervaly splatnosti.
8. Analýza pohledávek — největší dlužníci a existující metriky platební disciplíny.
9. Přehled plateb — počty výpisů a měsíční posouzení.
10. Rozdělení posouzení — podíl a úplný seznam vybraných zaúčtovaných importů.
11. Metodika a rozsah — filtry, datum sestavení a definice.
12. Souhrn reportu — již vypočtené hodnoty, zdroje a omezení.

Nezvolené oblasti a nepodporované údaje se nevymýšlejí. Tisková sestava neobsahuje interaktivní exportní formulář.

## 7. Stránkování

Výchozí A4 na výšku, volitelně skutečná A4 na šířku. Tabulkové řádky se měří podle zalomeného textu a dělí pouze mezi řádky. Pokračování má znovu hlavičku tabulky a společné záhlaví reportu. KPI a grafy se nedělí. Patičky se doplní až po dokončení dokumentu jako `Strana X z Y`.

Příliš dlouhý samostatný řádek nebo blok vrátí srozumitelnou chybu s doporučením užšího výběru či jiné orientace; obsah se neořízne.

## 8. Náhled

Stávající `DocumentPreview` používá PDF.js nad skutečným vráceným PDF. Náhled podporuje stránky, jejich náhledy, aktuální číslo, zoom a navigaci. Tentýž `File` a blob URL slouží i ke stažení a tisku.

Dialog zachová nastavení při chybě, umožní opakování a blokuje dvojí sestavení. Při změně konfigurace se starý soubor označí jako neaktuální a stažení/tisk se zablokují do nového sestavení. Zavření přeruší klientský požadavek; při výměně a odpojení komponenty se ruší blob URL. Fokus se vrací na tlačítko exportu.

## 9. Tisk

Tisk předává stejné PDF nativnímu prohlížeči přes iframe. Nabízí také samostatné otevření souboru pro prohlížeče, které přímé vyvolání tisku omezují. Aplikace při tomto postupu netiskne navigaci ani exportní ovládání. Klávesová zkratka Ctrl/Cmd+P v Reportech otevře export.

Automatizované ověření prokázalo vyvolání tiskové funkce nad PDF artefaktem. Systémový tiskový dialog a fyzický výstup na tiskárně automatizovaně ověřeny nebyly; konečné nastavení měřítka a papíru patří nativnímu prohlížeči/tiskárně.

## 10. Bezpečnost

Endpoint vyžaduje přihlášení, stávající finanční oprávnění a povolený původ požadavku. Organizaci a uživatele přebírá z ověřené identity, nikoli z klientských identifikátorů. Databázová funkce znovu kontroluje členství a role `admin`, `accounting`, `viewer`; zachovává tedy i existující přístup role viewer.

Nová `SECURITY DEFINER` funkce má prázdný `search_path`, kvalifikované názvy a právo volání pouze pro `service_role`. Přímé volání rolemi `authenticated`/`anon` je odebráno. Všechny datové projekce omezují organizaci.

Odpověď je soukromá, `no-store`, s `nosniff` a bezpečným názvem souboru. Finanční PDF se na serveru neukládá do dočasného veřejného úložiště. Technické chyby serveru se klientovi nevypisují. Export ověřuje shodu počtu podrobných faktur a importů se souhrny.

## 11. Výkon a limity

Jedna RPC na export, žádné spouštění headless prohlížeče na serveru, lokální fonty s cache jejich bytů a podmnožinou znaků, vektorové grafy a vykreslování do paměti. Dlouhé měsíční řady se dělí do čitelných skupin.

Přiznané limity: 5 000 vybraných faktur, 2 000 zaúčtovaných importů, období nejvýše 3 660 dní a maximálně 750 PDF stran. Při překročení vznikne chyba 413; nevydává se neúplný report. Tyto limity platí i pro souhrnný režim, protože datový snapshot zůstává společný. Abort na klientovi sám o sobě nezaručuje zastavení již běžícího SQL/PDF zpracování na serveru.

## 12. Skutečně provedené kontroly

- Cílená Vitest sada: **9 souborů, 73 testů prošlo**. Obsahuje PDF, API, stávající reportovací výpočty a související regrese. Nové PDF kontroly ověřují přesné velké a záporné částky, režimy, české znaky, číslování, A4, úplnost 300 faktur, 80 dlouhých zákaznických názvů a skutečné pozice textu v okrajích stránek.
- `node scripts/test-financial-report-db.mjs`: **PASS financial_report, invoice_creation, dashboard_snapshot** nad izolovanou PGlite databází s přehráním migrací. Ověřena shoda s autoritativními souhrny, členství a tenant, viewer, měna/zákazník, numerické pořadí zákazníků, přesné peněžní řetězce, pražská půlnoc importů, bezpečné/ruční posouzení i odmítnutí nadlimitní sestavy.
- `node scripts/financial-report-check.mjs` a varianta `--webkit`: **obě prošly**. Šířky 320, 390, 768, 1024 a 1440 px; životní cyklus náhledu při 390 i 1440 px, simulovaná chyba 503 a opakování, zoom, další stránka, stažení, tisková funkce, změna filtrů, blokace starého artefaktu a návrat fokusu. Chyba 503 je záměrný test, nikoli produkční selhání.
- `corepack pnpm typecheck`: **prošlo**.
- `corepack pnpm lint`: **prošlo, bez varování**.
- `APP_BASE_URL=https://www.splatno.com corepack pnpm build`: **prošlo**. Samotný build s lokální HTTP adresou byl správně odmítnut existujícím validátorem produkční konfigurace; soubory prostředí nebyly měněny.

Prohlížečové testy vykreslují skutečné komponenty aplikace a skutečné PDF, ale HTTP data dodávají syntetické fixtures. Produkční API/databáze se tímto testem nevolají. Jejich bezpečnost a výpočty ověřují samostatné API a SQL testy; nejde o tvrzení, že proběhl export živých klientských dat.

## 13. Vizuální kontrola skutečných PDF

`scripts/financial-report-preview.mjs` vytvořil šest PDF a na macOS jejich stránky vyrenderoval přes `sips` do PNG. Prohlédnuty byly kontaktní listy všech 48 vygenerovaných stran: kompletní 12, souhrnný 2, detailní 6, vlastní 10, prázdný 1 a 300 faktur 17. Kontrola zahrnula titulní stranu, KPI, grafy, daňové a fakturové tabulky, pokračování, metodiku a závěr.

Nebyla vidět překrytí, ořezané záznamy ani chybějící patičky; dlouhá tabulka pokračuje s opakovanou hlavičkou a končí posledním dokladem. Doplněná strojová kontrola textových souřadnic prověřuje i dlouhé názvy. U řídkých dat mají samostatné kapitoly záměrně volnou spodní část; počet stran určuje zvolený režim a obsah.

Ukázky: [kompletní PDF](../redesign/visual-validation/financial-reports/complete.pdf), [detailní PDF](../redesign/visual-validation/financial-reports/detailed.pdf), [souhrnné PDF](../redesign/visual-validation/financial-reports/summary.pdf), [300 faktur](../redesign/visual-validation/financial-reports/hundreds.pdf). Výsledky a screenshoty jsou ve stejném adresáři. Původní audit a dřívější vizuální baseline nebyly přepsány.

## 14. Omezení a nasazení

- **Před nasazením aplikovat migraci `20261026101041_financial_report_snapshot.sql`** v obvyklém pořadí za předchozími migracemi projektu. Bez ní nový endpoint nevytvoří snapshot. Migrace nebyla spuštěna na živém projektu.
- Přirozeně delší reporty nejsou omezeny na dvanáct stran; nepoužívá se tiché zkracování.
- Detail bankovní části je úplný seznam zaúčtovaných importů, nikoli export každého jednotlivého bankovního řádku; dokument to výslovně uvádí.
- DPH a pohledávky zachovávají omezení stávající metodiky, včetně nerozlišovaných režimů starších dokladů a současného stavu pohledávek.
- Existující Excel export zůstává dostupný a používá původní filtry stránky. Dialog to popisuje; změny konfigurace PDF jeho význam nemění.
- Fyzický tisk, všechny nativní PDF prohlížeče, souběžná zátěž produkčního serveru a ostrá klientská data nebyly testovány. Limity nejsou benchmarkem produkční kapacity.
- Žádné nasazení, odeslání reportu třetí osobě ani finanční změna v produkci nebyly součástí úkolu.
