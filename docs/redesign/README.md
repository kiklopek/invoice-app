# Splatno 2.0 — audit P00

Původní audit P00 zůstává zachovaný. Uživatel následně výslovně zadal implementaci konkrétního dashboard packu SPL-DASH-001; poslední zadání rozšiřuje dashboard a jeho prezentační závislosti také o společný sidebar a pozadí interních stránek. Ostatní redesignové fáze se automaticky nezahajují. Pracovní větev: `design-rebuild`, aplikační baseline: `f0f5fcb`.

| Dokument | Obsah |
| --- | --- |
| [00 — master plán](00-master-plan.md) | Přesná kopie dodaného `SPLATNO_V2_MASTER_PLAN.md` |
| [Šablona mikroplánu](prompts/phase-template.md) | Přesná kopie dodaného `PHASE_SPEC_TEMPLATE.md` |
| [Původní první úkol](00-start-prompt.md) | Přesná kopie zadání omezujícího práci na P00 |
| [01 — obrazovky](01-screen-inventory.md) | 28 rout, metadata pro každou a 189 stavových/kontrolních položek |
| [02 — designový a funkční kontrakt](02-design-contract.md) | Schválený směr z plánu, invarianty a rozdíly oproti implementaci |
| [Auditní report](02-audit-report.md) | Nálezy, priority a meze důkazů |
| [03 — routy a kontrakty](03-route-and-contract-map.md) | 68 handlerů, auth/role, API a vedlejší účinky |
| [04 — komponenty](04-component-inventory.md) | UI, formuláře, loadery a CSS kaskáda |
| [05 — testy](05-testing-matrix.md) | Skutečné příkazy, výsledky a plán regresí |
| [06 — průběh](06-progress.md) | P00 gate, blokery a malá PR přiřazená P01–P18 |
| [07 — rozhodnutí](07-decisions.md) | Rozhodnutí a nevyřešené odlišnosti |
| [P00 mikroplán](phases/P00-audit.md) | Vyplněná dodaná struktura deseti oddílů |
| [Registr mockupů](mockup-register.md) | Rozlišení deklarovaného schválení, konkrétní verze a původního UI |
| [Zdrojová inventura](source-inventory.json) | Úplný seznam rout, importů, stylů a testů |

Původ a SHA-256 dodaných plánů jsou v [evidence/planning-sources.json](evidence/planning-sources.json). Jejich kopie se neanotují přímo; interpretace a rozpory patří do kontraktu a rozhodnutí. Historický brief ani staré screenshoty nemají přednost před nyní dodaným master plánem.

**P00 ještě čeká na bezpečnou aktuální screenshotovou baseline a uživatelskou revizi.** Testy z minulého kroku zůstávají platným lokálním důkazem stejného aplikačního commitu; při nynější aktualizaci dokumentů nebyly znovu spuštěny. Žádný produkční zápis, nový commit, PR nebo push neproběhl. Nová lokální dashboard implementace a její ověření jsou popsány níže.

## Aktuální implementační výstup: SPL-DASH-001

[Specifikace a zachované kontrakty](screens/dashboard/spec.md), [výsledky a screenshoty](screens/dashboard/acceptance.md), [ověření a hashe zdrojů](screens/dashboard/verification.json). Nové testy: 200 souborů / 1 714 testů; 32 Chromium + 32 WebKit fixture scénářů, lint/typecheck a izolovaný produkční build. Není to živý authenticated Supabase E2E ani schválení vzhledu uživatelem. Globální P00 screenshotový gate se tímto neprohlašuje za uzavřený.

## Aktuální doplnění dashboardu

[Single-screen refinement](screens/dashboard/refinement.md) optimalizuje desktop 1536 × 1024 a 1440 × 900, doplňuje čitelnější pracovní náhledy a hodnoty grafu na hover/focus. Závěrečné výsledky a aktuální hashe jsou v [refinement-verification.json](screens/dashboard/refinement-verification.json); starší evidence výše popisuje první implementaci.

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
