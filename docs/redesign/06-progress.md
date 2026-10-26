# P00 — průběh, blokery a návrh malých PR

**Stav: dodaný master plán a šablona zapracovány; P00 čeká na aktuální bezpečnou screenshotovou baseline a uživatelskou revizi.** Baseline `f0f5fcb`, větev `design-rebuild`, 17. 10. 2026. Žádné změny aplikace, backendu, konfigurace, migrací ani produkčních dat. Žádný nový commit, PR ani push nebyl v P00 proveden.

## Provedeno

- [x] Přečten uživatelem zadaný start prompt a existující úplný screen checklist.
- [x] Zkontrolována větev a předchozí lokální změny; `main` ponechán beze změn.
- [x] Router, server/client hranice, loading/error/404, role a auth návraty.
- [x] 28 stránek + 189 stavových/kontrolních položek, výstupy, dialogy a varianty.
- [x] 64 API rout + 4 ostatní route handlery včetně TSX OG handleru.
- [x] Komponenty, stylová kaskáda, formuláře, SWR/cache, validace a datové loadery.
- [x] Tenancy/RLS zdroje, onboarding, OCR, párování, reminder queue/delivery, billing a šablony.
- [x] Lokální lint/typecheck/unit/migration check a izolované SQL runnery, evidence v dokumentu 05.
- [x] Rozpory historických podkladů se skutečnou implementací výslovně zaznamenány, neopraveny.
- [x] Připraven konkrétní dokumentační obsah prvního malého PR a podmíněné rozdělení další práce.
- [x] Přečíst a přesně zkopírovat dodaný master plán, uložit původ a SHA-256.
- [x] Přečíst a přesně zkopírovat phase spec template, vyplnit P00 a přiřadit oficiální fáze.
- [x] Dodat designový/funkční kontrakt a porovnání plánu s kódem (včetně CSV atomického importu a skutečných rolí).
- [ ] Pořídit aktuální desktop/tablet/mobile baseline s bezpečnými syntetickými daty dle P00.D5.
- [ ] Přiřadit konkrétní schválené mockupy, verze a schvalující osobu.
- [ ] Uzavřít P00 schválením; teprve pak pokračovat podle potvrzeného plánu.

## Blokery a otevřené závislosti

| ID | Stav / priorita | Závislost a dopad | Další krok |
| --- | --- | --- | --- |
| B01 | Vyřešeno | Master plán dodán, přečten, přesně zkopírován do 00 | Původ a hash v evidence/planning-sources.json. |
| B02 | Vyřešeno | Phase template dodána, přečtena, přesně zkopírována | P00 zapsána podle deseti oddílů šablony. |
| B03 | Otevřeno / P0 pro implementaci | Konkrétní artefakty/verze návrhů nejsou dodány, ačkoli plán u části deklaruje schválení | Doplnit M01–M21 s R/ST a konkrétními soubory/frame/verzí. Nevyžaduje znovu schvalovat již deklarovaný směr. |
| B04 | Otevřeno / P1 runtime | Izolované fixture prostředí, test role/data a důkaz striktního E2E nejsou potvrzeny | Ověřit bezpečný cíl; nepoužít produkční recovery/service přihlášení. |
| B05 | Otevřeno / podmíněné | Nasazení comprehensive search migrace nebylo v P00 potvrzeno | Samostatný read-only drift check, případná DDL mimo vizuální PR. |
| B06 | Otevřeno / P0 pro P00 gate | Master D.5 požaduje aktuální screenshoty desktop/tablet/mobile se seedovanými bezpečnými daty; nebyly pořízeny | Připravit/ověřit syntetické fixture prostředí a doplnit baseline manifest/snímky. Historické screenshoty to nenahrazují. |
| B07 | Čeká na revizi | Gate P00 výslovně požaduje uživatelskou revizi dokumentu | Předložit audit včetně skutečných mezer; dodání souborů není souhlas s P01. |

B01/B02 již nejsou blokery. B03 je vstup pro budoucí vizuální implementaci, nikoli důvod znovu zastavit nezávislou dokumentaci. B06/B07 zůstávají otevřené podmínky přijetí P00. Nové rozpory C01–C08 jsou v dokumentu 02-design-contract; neřeší se svévolnou změnou produktu.

## První malý bezpečný PR — konkrétní návrh

**`docs: P00 inventory and contract baseline`**

Rozsah: pouze nový adresář `docs/redesign/` s tímto balíčkem. Žádná změna dependencies, CSS, TSX aplikace, API, SQL nebo CI. Base pro návrhovou práci: `design-rebuild`; žádný automatický merge do `main`. Nezahrnout předchozí `next-env.d.ts` a `.DS_Store`.

Akceptace: souhlasí všech 28 rout, 68 handlerů a vazby na zdroje; žádné fiktivní schválené mockupy; master/template přesně zkopírovány a ověřeny hashem; otevřené podmínky baseline a uživatelského review výslovně uvedeny; lokální evidence odlišena od neprovedeného stagingu. Dokumentační PR nepotřebuje vizuální mockup, protože vzhled nemění. Rollback: revert samotného dokumentačního commitu.

## Rozpad oficiálních fází do malých PR

Fáze odpovídají dodanému master plánu. Níže jde o **návrhy rozsahu PR, nikoli souhlas je implementovat**. Konkrétní mockup/frame/verze zatím chybí; odkaz M označuje položku registru a její skutečný stav, ne dostupný obrázek. Před každým vizuálním PR vyplnit dodanou šablonu, R/ST a oba typy akceptace.

| Fáze / navržená samostatná PR | Reálné routy a stavy | Reference návrhu | Brána a závislost |
| --- | --- | --- | --- |
| P01.A sémantické tokeny pro omezený showcase; P01.B prověřené legacy aliases | Společné ST-154–173, 183–189; landing/auth/print spot-check | M12: směr schválen, přesné tokeny/spec čekají | Po P00. Bez slepého globálního override; kontrast, focus/reduced motion a vizuální regrese. |
| P02.A button/field rodina; P02.B dialog/drawer; P02.C table/filter/upload po jednotlivých rodinách | Konzumenti dle source-inventory; jedna rodina za PR | M12: konkrétní stavy/showcase čekají | P01 + testový základ P04; focus, Escape, touch, disabled/busy/error. |
| P03.A desktop shell; P03.B tablet/mobile nav; P03.C Eško/overlay | Všechny workspace routy, ST-154–173 | M12 a relevantní M01; shell reference čeká | P02; role/deep links/menu, žádný duplicitní profil, stacking a nepřekrytá CTA. |
| P04.A izolované fixtures; P04.B capture baseline; P04.C kritické CI scénáře | Všechny R, vybrané ST a P18 flow | Staré UI capture, bez změny vzhledu; B06 | Po P00; P00 baseline je vstup, P04 rozšiřuje automatizaci. Žádné reálné e-maily/charge. |
| P05.A souhrny; P05.B grafy/attention; P05.C empty/error/mobile | R16, ST-045–048 | M01: schválení deklarováno, artefakt čeká | P03/P04; skutečné KPI a role, unchanged loader. |
| P06.A list/filtry; P06.B řádky/akce; P06.C archiv; P06.D dialog/mobil | R21/R18, ST-049, 053–063 + relevantní systémové ST | M02 + M13; obě konkrétní reference čekají | P03/P04; query, counts, export; C06 bulk rozsah ověřit před prací. |
| P07.A přidání ke sledování; P07.B read-only detail; P07.C edit/platby; P07.D neobvyklá data | R20/R17, ST-050, 052–063 | M04/M03 čekají na verzi; C01 negativní částky | P06 a sdílený form; žádný nový vystavovací proces, zachovat PDF/send/money guards. |
| P08.A upload; P08.B single review; P08.C queue; P08.D CSV; P08.E mobil | R19, ST-051, 064–071 | M05–M07: artefakty čekají; CSV specifikace navíc | P07; zachovat OCR provenance/queue. C02 CSV all-or-nothing, žádný nový partial write/map wizard. |
| P09.A výběr/dropzone; P09.B pending/error/duplicate/account | R23 úvod, ST-072, 074–075, 082–083, 086 | M08 schválení deklarováno, artefakt čeká | P03/P04 + existující parser; bez zaúčtování, nezměnit CAMT flag. |
| P10.A review layout; P10.B návrh/nejasná; P10.C chooser; P10.D split; P10.E commit; P10.F chyby/fronta | R23 review, ST-076–086 | M09 + M14, zejména split/partial zvlášť | P09; golden fixtures, revision, účet ack, no double-posting; jedna riskantní větev za PR. |
| P11.A historie; P11.B detail/release; P11.C archiv originálů; P11.D mobil | R22, ST-073, 087–092 | M15 návrh čeká | P10; faktury/report/audit konzistentní, private original download. |
| P12.A adresář; P12.B kontakt edit; P12.C mobil a velká data | R15, ST-093–101 | M16 návrh čeká | P03/P04; copy bez navigace, správná firma a příjemce, žádná nová detail route. |
| P13.A Tržby; P13.B společné filtry; P13.C další pohledy samostatně; P13.D tisk/export | R26, ST-102–108 | M11 verze čeká; M17 další pohledy potřebují návrh | P03/P04; zachovat agregace, měny a DPH; A4/Excel zvlášť ověřit. |
| P14.A harmonogram; P14.B provoz/doručení; P14.C editor; P14.D logo/mobile | R25/R27, ST-120–140 | M10 + M18 artefakty/spec čekají | P03 a P15 dle sdílených prvků; zachovat společný versionovaný PUT a nezávislý logo save. |
| P15.A firma/účty; P15.B tým; P15.C support; P15.D draft/role | R28, ST-109–119 | M19 návrh čeká | P03/P04; skutečné admin/accounting/viewer dle C03, validace a cross-tenant. |
| P16.A aktuální stav/usage; P16.B plány/preview; P16.C card/cancel/return | R24, ST-141–149 | M20 návrh čeká | P03/P04; Stripe sandbox, server entitlement, žádné nové cenové výpočty. |
| P17.A veřejný web — jedna sekce za PR; legal samostatně | R09–R12, ST-001–014 | M21; zachovat současný vzhled, pokud není změna specifikovaná | Až příslušný podplán, CS/EN, SEO, video/motion/FAQ. |
| P17.B login, signup/OTP, invitation, recovery jako oddělená PR | R01–R08, ST-015–030 | M21 konkrétní specifikace čeká | MFA/session kontrakty, pět alfanumerických znaků, rate limits, žádné auth změny. |
| P17.C rámec progress; kroky 1–2/3–4/5–6/7/8 samostatně dle rozsahu | R13, ST-031–044 | M21 osm kroků/stavy čekají | Resume draft, ARES failure, tým/logo partial a billing return. |
| P17.D konzole/support vstup a ukončení odděleně | R14, ST-150–153 | M21 spec čeká | Operator guard, support expiry/reason/audit, žádná privilege escalation. |
| P17.E system/error/loading; dialogy/banner vrstvy podle konzumentů | Všechny R, ST-154–173 | M12/M21 stavové reference čekají | Focus, retry, dirty state, žádné nové backend error semantics. |
| P17.F OTP/invite/recovery; reminder/invoice mail; PDF/print zvlášť | ST-174–182 + skutečné output handlery | M18/M21 výstupy čekají | Escaping, fonty, QR, proměnné; nepřepsat výstupy přes screenshot. |
| P17.G průřezová responsive/a11y oprava vždy malý doložený problém | Všechny R/ST-183–189 | Schválené component/route spec + před/po | 320/375/430/768/1024/1440/1600, ±1 px a zoom; žádná tvrzená shoda WCAG bez auditu. |
| P18.A integrační důkazy; P18.B performance/security audit; P18.C staging/rollback/release report | Všechny R/ST a celé kritické flow | Schválené verze předchozích fází, fixture capture | Teprve po funkční/vizuální akceptaci bloků; release-readiness, bez automatického production release. |

Základní pořadí: P00 → P01/P04 → P02 → P03 → funkční bloky dle masteru → P17 → P18. P04 se netváří jako náhrada chybějící vstupní P00 baseline. P14/P15 mohou sdílet komponenty, ale nebudou sloučeny do jednoho velkého PR; nová UI knihovna nebo API změna vyžaduje samostatné rozhodnutí.

## Stop bod

Dodaný plán a template jsou zapracované, redesign se nezahajuje. P00 master D požaduje screenshotovou baseline a uživatelskou revizi. Zbývající mezery jsou B06/B07; pro pozdější vizuální implementaci navíc B03. Původní zadání výslovně říká po auditu zastavit a čekat na schválení.

## Nové výslovné zadání — SPL-DASH-001

Po dodání masteru uživatel dodal dashboard pack a výslovně požádal jeho realizaci. To povoluje tento konkrétní prezentační rebuild i přes dosud neuzavřený globální P00 gate; nepovoluje ostatní redesignové bloky ani změny backendu/main.

DASH-PR01–06 jsou zpracované jako lokální logické části: audit/before, omezený dashboard shell, header/KPI, chart/donut, skutečné recent/upcoming listy, stavové/responsive ověření. Samostatné GitHub PR ani commity nejsou vytvořené. Testy/screenshoty/odchylky jsou v `screens/dashboard/acceptance.md`, přesné zdrojové hashe ve verification JSON. Stav: **implementováno lokálně, čeká na vizuální revizi uživatelem**. Další stránka se automaticky nezačíná.

## Dodatečné zadání — single-screen dashboard, 18. 10. 2026

Desktopový refinement výslovně povoluje omezené náhledy posledních faktur a plánovaných upomínek. Zachované plné seznamy, role, výpočty a read API. Viewport grid, přirozený scroll při nedostatku prostoru, žádné výchozí vnořené scrolly. Aktuální důkazy jsou v `screens/dashboard/refinement.md` a `refinement-verification.json`; původní implementační evidence zůstává historicky zachovaná. Práce pokračuje pouze v `design-rebuild`, bez pushnutí.

## Finální porovnání s referencí — 18. 10. 2026

Nové výslovné zadání nahrazuje předchozí čtyřřádkový preview a umístění Eška v sidebaru. Dashboard nyní zobrazuje pět faktur a Eška vpravo dole. Skutečná Next baseline, rozměrové tabulky, screenshoty, overlay/difference, výsledky a konflikty se schváleným mockupem jsou v `docs/redesign/visual-validation/dashboard/visual-comparison.md` a `validation.json` (cesty od kořene repozitáře). Zůstává ve větvi `design-rebuild`, bez commitu či nasazení. Starší screenshotové zprávy popisují předchozí iterace.


## Aktuální cílené doplnění — společný shell a stavový graf, 18. 10. 2026

Poslední výslovné zadání rozšířilo scope o globální sidebar a jednotné pozadí interních stránek. Jejich sdílené komponenty jsou zapojené, dashboard zachovává již vyhovující single-screen geometrii a doplňuje pravdivé barevné série ze stávajících filtrovaných reportů. Nový zdroj notifikací neexistuje; připravený je pouze plán. Aktuální důkazy a zbývající odchylky: [vizuální porovnání](visual-validation/dashboard/shared-shell/visual-comparison.md), [datový kontrakt](visual-validation/dashboard/shared-shell/data-contract.md), [ověření](visual-validation/dashboard/shared-shell/validation.json). Předchozí záznamy zůstávají historií, nikoli aktuálním tvrzením o počtu řad či scope. Větev `design-rebuild`; bez commitu, pushe nebo deploymentu.


## Nejnovější vizuální dopracování dashboardu — 18. 10. 2026

Dokončené cílené úpravy podle následného porovnání: skutečná časová osa a ovládání upomínek vybrané faktury, menu faktur, hlavička a nabídka grafu, barvy KPI, pozadí, profil a správná ilustrace Eška. Uživatel výslovně ponechal profil jen vlevo dole a odmítl zvonek; konkrétní čísla jsou mimo vizuální hodnocení. Single-screen při 1536 × 1024 i 1440 × 900 zachovaný. Aktuální [screenshot a porovnání](visual-validation/dashboard/precision/visual-comparison.md), [ověření](visual-validation/dashboard/precision/validation.json): 1 752 testů / 202 souborů, 79 Chromium + 79 WebKit scénářů, lint, TypeScript a produkční build. Historické záznamy výše platí pro předchozí iterace. Bez backendových změn, produkčních zápisů, commitu či pushe.


## Proporce podle viewportu a detaily KPI — 18. 10. 2026

Opravené notebookové breakpointy a viditelnost procent/částek KPI. Výchozí dashboard se vejde také na 1180 × 660, 1280 × 800 a 1366 × 768; tablet na výšku a telefon se čitelně přeskupují s přirozeným scrollem. Upomínky mají vždy přítomný panel včetně prázdného stavu. Procento vychází ze skutečných počtů posledních 30 dnů proti předchozím 30 dnům. Aktuální [měření a screenshoty](visual-validation/dashboard/fluid/visual-comparison.md), [ověření](visual-validation/dashboard/fluid/validation.json): 16 skutečných Next viewportů, 88 Chromium + 88 WebKit kontrol, 1 759 testů / 202 souborů, lint, TypeScript a izolovaný build. Starší evidence zůstává historická. Větev `design-rebuild`, bez commitu, pushe a produkčních zápisů.


## Využití výšky, KPI a plán upomínek — 18. 10. 2026

Spodní rezerva je přesunutá do vzdušnějšího uvítání, KPI mají ikony svisle uprostřed a údaje v jednom zarovnaném sloupci. Upomínky nyní ukazují skutečný plán z faktury i před vytvořením záznamu o odesílání, bez duplicity queued události a s minutovým obnovením. [Aktuální screenshoty a naměřené rozdíly](visual-validation/dashboard/balance/visual-comparison.md), [ověření](visual-validation/dashboard/balance/validation.json): 16 Next viewportů, 88 Chromium + 88 WebKit kontrol, 1 763 testů / 202 souborů, lint, TypeScript a izolovaný build. První přetížený testovací běh měl dva OCR timeouty; celý opakovaný běh prošel bez změn OCR. Větev `design-rebuild`, bez commitu, pushe, backendových změn nebo produkčních zápisů. Starší evidence zůstává historická.


## Proporce reference a rovnoměrné využití viewportu — 18. 10. 2026

Uvítání opět odpovídá výškou obsahu původní reference; volná výška se rozděluje mezi grafy a spodní panely. Faktury a upomínky mají společnou spodní hranu a řádky tabulky rovnoměrně vyplňují kartu. Na desktopu zůstává pouze běžné odsazení u spodního okraje. [Aktuální screenshoty a porovnání](visual-validation/dashboard/proportions/visual-comparison.md), [ověření](visual-validation/dashboard/proportions/validation.json): 18 Next viewportů, 90 Chromium + 90 WebKit kontrol, 76 relevantních testů, lint, TypeScript a izolovaný build. Beze změn dat/API/backendu; větev `design-rebuild`, bez commitu nebo pushe. Starší evidence je historická.


## Nižší grafy a prostor kolem uvítání — 18. 10. 2026

Snížená výška obou grafů se přesouvá do mezer nad a pod uvítáním; spodní panely zachovávají zarovnání. Z přehledu stavu faktur je na výslovné přání odstraněná „Nejasná platba“, bez změn platební agendy/API. [Screenshoty a měření](visual-validation/dashboard/compact-charts/visual-comparison.md), [ověření](visual-validation/dashboard/compact-charts/validation.json): 18 Next viewportů, 90 Chromium + 90 WebKit kontrol, 76 relevantních testů, lint, TypeScript a izolovaný build. Větev `design-rebuild`, bez commitu/pushe.


## KPI v jednom řádku s ikonou — 18. 10. 2026

Hlavní čísla mají stejný svislý střed jako ikony. Částky a procentní srovnání jsou napravo, s přirozeným zalamováním a kratším popiskem „oproti minule“. Nové výslovné zadání nahrazuje starší centrování ikony vůči celé kartě. [Screenshoty](visual-validation/dashboard/kpi-inline/visual-comparison.md), [ověření](visual-validation/dashboard/kpi-inline/validation.json): 18 Next viewportů, 90 Chromium + 90 WebKit kontrol, 76 relevantních testů, lint, TypeScript a izolovaný build. Bez datových/API změn, commitu nebo pushe; větev `design-rebuild`.


## Vyvážené KPI s ikonou uprostřed celé karty — 18. 10. 2026

Podle nového výslovného zadání má KPI vlevo 48px ikonu svisle uprostřed celé karty a vpravo sloupec nadpisu, hodnoty a detailu. Desktop: mezera 18 px, padding 20 × 24 px, výška 134 px; menší viewports mají kompaktnější odsazení. Barvy, typografie a data zachované. Nahrazuje předchozí KPI inline variantu. [Screenshoty](visual-validation/dashboard/kpi-balanced/visual-comparison.md), [ověření](visual-validation/dashboard/kpi-balanced/validation.json): 18 Next viewportů, 90 Chromium + 90 WebKit kontrol, 76 relevantních testů, lint, TypeScript a izolovaný build. Větev `design-rebuild`, bez commitu/pushe.


## Poslední faktury: sloupce a částky — 18. 10. 2026

Mírně více prostoru pro dlouhé identifikátory, odběratele a částky; vycentrované hlavičky i hodnoty, tučné částky. Poměry se přizpůsobují úzkému desktopu, aby se zbytečně nezalamovala běžná čísla faktur a data. [Screenshoty a rozměry](visual-validation/dashboard/invoice-columns/visual-comparison.md), [ověření](visual-validation/dashboard/invoice-columns/validation.json): 18 Next viewportů, 90 Chromium + 90 WebKit kontrol, 26 relevantních testů, lint, TypeScript a izolovaný build. Větev `design-rebuild`, bez commitu/pushe a bez změn dat/API.


## Firemní přehled automatických upomínek — 18. 10. 2026

Na výslovné nové zadání byl dashboardový detail vybrané faktury nahrazen přehledem nejvýše tří nejbližších skutečných plánů. Počet odeslaných je firemní; stav výchozího automatu má přesné označení a odkaz Spravovat. Položky ověřují pauzu, e-mailovou blokaci a aktuální stav přes existující čtecí API. Historie a ovládání jednotlivé faktury zůstávají v jejím detailu. Čtenář nevolá chráněná nastavení. Eško je kompaktní globální widget u pravého okraje, mimo odkazy panelu. [Screenshoty a kontrakt](visual-validation/dashboard/company-reminders/visual-comparison.md), [ověření](visual-validation/dashboard/company-reminders/validation.json): 18 Next viewportů, 90 Chromium + 90 WebKit kontrol, 202 souborů / 1 762 testů, lint, TypeScript a izolovaný build. Bez backendových změn, skutečných e-mailů, produkčních mutací, commitu/pushe. Větev `design-rebuild`; starší specifikace per-invoice panelu je historická.
