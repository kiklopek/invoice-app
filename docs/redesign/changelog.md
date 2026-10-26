# Redesign changelog

## SPL-DASH-001 — lokální dashboard rebuild

- Explicitní zadání uživatele: dodaný dashboard pack; omezeno na `/dashboard` a scoped shell/ikony.
- Nový světlý layout, dynamická hlavička/search/CTA, čtyři KPI, report graf a status donut, zachované pracovní seznamy a skutečný Eško.
- Nové UI a prezentační kontraktové testy; aktualizace pouze neplatných layout assertions, žádné skipy.
- 1 714 testů, lint/typecheck a izolovaný produkční build prošly; 32 Chromium + 32 WebKit fixture scénářů, 3 before snímky.
- API/backend/schema/RLS/business beze změn, produkční data/mail/charge nedotčeny. Necommitnuto, nenasazeno. Další obrazovka ani globální fáze nejsou automaticky zahájeny.
- Detail, odchylky, rizika a důkazy: `screens/dashboard/acceptance.md` a `verification.json`.

## 18. 10. 2026 — single-screen refinement

- Viewport grid pouze pro dostatečně velký desktop, přirozený scroll na menších rozlišeních, zoomu a rozbaleném obsahu. Odstraněný scroll uvnitř seznamů.
- Čtyři poslední faktury, tři nejbližší plánované upomínky s přístupem k dalším; zdrojové pořadí a finanční souhrny zachované.
- Období grafu v uvítání, čitelnější typografie, tooltip na hover/focus, zjemněné pozadí a Eško mimo důležitá tlačítka.
- Záznam ověření: `screens/dashboard/refinement-verification.json`. Bez commitu/deploymentu.

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
