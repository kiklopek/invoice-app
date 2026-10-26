# Mobilní reporty Splatno — implementace

Dokončeno 25. 10. 2026. Změny vzhledu a ovládání jsou omezené na obrazovky pod 768 CSS px. Implementace používá skutečný ReportsClient a jeho původní data, dotazy a exportní handlery.

## A. Změněné soubory

| Soubor | Důvod změny |
| --- | --- |
| `src/app/(workspace)/reports/reports-client.tsx` | Napojení mobilních ovládacích prvků na stávající stav, dva hlavní ukazatele s dostupným rozbalením dalších, čitelné mobilní tabulky, dotykové detaily grafů a přístupná metodika. |
| `src/app/(workspace)/reports/reports.module.css` | Styly mobilních reportů, kompaktní karty, grafy, seznam pohledávek, responzivní panely a jejich omezení na dostupný viewport. Nové prezentační styly jsou v mobilních media queries. |
| `src/app/(workspace)/reports/report-mobile-controls.tsx` | Společný výběr období, návrhy filtrů, jejich potvrzení a reset, skutečný počet aktivních filtrů, mobilní export a panely postavené na stávajícím nativním Modal. |
| `src/app/(workspace)/reports/report-mobile-controls.test.ts` | Testy počítání filtrů, bankovního kontextu a rozpoznání období včetně shody rozsahu měsíce a čtvrtletí. |
| `scripts/mobile-reports-check.mjs` | Nové prohlížečové testy, snímky 15 velikostí, porovnání původního desktopu/tabletu a funkční scénáře pro Chromium a WebKit. |
| `scripts/reports-design-check.mjs` | Přizpůsobení existujících mobilních kontrol novým panelům; zachování desktopových regresí a oprava testovací odpovědi oznámení podle současného kontraktu. |
| `scripts/mobile-header-design-check.mjs`, `scripts/mobile-invoices-check.mjs` | Odstranění dvou nepoužívaných proměnných, které bránily celorepozitářovému lintu. Chování těchto testů se nemění. |

## B. Responzivní rozložení

- Kompaktní nadpis s exportem, původní čtyři záložky, jedno tlačítko období a jedna ikona filtrů.
- Primární metriky ve dvou sloupcích; další původní metriky lze rozbalit přes „Další ukazatele“.
- Osa grafu a zkratky měsíců přizpůsobené malé šířce. Dlouhé řady používají pouze místní posuv grafu; stránka se vodorovně neposouvá.
- Panely mají dostupné zavření, Escape, návrat fokusu, vnitřní posuv obsahu a samostatnou patičku. Omezují výšku podle visualViewport i dynamických CSS jednotek a respektují spodní safe area.
- Globální záhlaví, navigace ani jiné stránky nebyly redesignovány.
- Při šířkách 768 px a výše zůstává původní rozložení. Ověřeno 24 porovnáními snímků proti výchozímu stavu; tolerance jen 3 stupně barevného kanálu kvůli drobným rozdílům vykreslení hran.

## C. Filtry a období

Původní velký panel je na mobilu nahrazen kompaktními ovládacími prvky. Otevřený panel inicializuje návrh ze skutečně použitých hodnot. Teprve „Použít“ / „Použít filtry“ předá změny původnímu stavu ReportsClient. Zavření nebo Escape návrh zahodí. Reset obnoví původní výchozí hodnoty v návrhu a vyžaduje potvrzení.

Předvolby využívají původní `reportPresetRange`. Vlastní datum používá nativní datumová pole, omezení od/do a validaci rozsahu. Rozsah se nepočítá jiným způsobem. Volba čtvrtletí se správně pojmenuje i v prvním měsíci čtvrtletí, kdy odpovídá rozsahu měsíce.

Badge počítá pouze ne-výchozí měnu, stav, odběratele a datumové pole. Samostatně zobrazené období nepočítá. Bankovní report fakturové filtry nenabízí ani nepočítá; jejich nastavení pro návrat k fakturovým reportům zachovává. Návrhy změn nespouštějí dotazy.

## D. Jednotlivé reporty

- **Tržby:** dvě hlavní metriky, zachované další ukazatele, čitelný měsíční graf a přesné údaje po klepnutí na sloupec; přehled odběratelů s částkami, podílem a skutečným filtrováním. Metodika zůstává dostupná po rozbalení.
- **DPH:** primární DPH a základ ostatních sazeb; zbývající metriky dostupné po rozbalení. Hlavní tabulka na mobilu zobrazuje sazbu, základ a daň. Částky s DPH a počty faktur jsou dostupné v připojeném rozbalení. Zachován donut i kvalifikace k orientačnímu daňovému přehledu.
- **Pohledávky:** otevřené a opožděné zůstatky, všech pět původních pásem stáří s počtem, přesnou částkou a zarovnaným pruhem; zachovaná platební disciplína a historie. Největší pohledávky jsou mobilní seznam s odběratelem, oběma částkami, počtem faktur a upomínek.
- **Platby:** počty přijatých řádků a bezpečných návrhů; ruční posouzení a nespárované platby zůstávají dostupné. Zachován měsíční graf, rozdělení posouzených řádků i informace o rozdílných populacích a datech.

## E. Zachovaná funkčnost

Nebyla měněna databáze, RLS, API, autentizace, oprávnění, finanční knihovny, výpočty DPH, hranice stáří pohledávek, zpracování výpisů ani generování exportních dat. Mobil i desktop používají stejné výstupy SWR a stejný aplikovaný stav; nepřibyl paralelní zdroj reportových dat.

Excel volá původní handler se skutečně aplikovanými fakturovými filtry. Tisk/PDF používá původní kompletní tiskovou sestavu se všemi kapitolami. Rozhraní výslovně uvádí, že XLSX neobsahuje výpisy, zatímco PDF obsahuje firemní přehled výpisů. CSV se nezobrazuje, protože původní implementace tento export nepodporuje.

## F. Provedené ověření

- `npm run lint` — prošel, bez varování.
- `npm run typecheck` — prošel.
- `APP_BASE_URL=https://www.splatno.com npm run build -- .cache/invoices-build` — prošel; produkční webpack build v oddělené složce, vygenerováno 86 stránek.
- Vitest: původní reportové, prezentační a tiskové testy + nové testy ovládání — **40 testů v 6 souborech prošlo**.
- `node scripts/mobile-reports-check.mjs` — **22 scénářů prošlo**, zahrnuje všechny čtyři reporty ve všech 15 požadovaných velikostech a funkční mobilní scénáře.
- `node scripts/mobile-reports-check.mjs --functional-only --webkit` — **7 scénářů prošlo** v Safari/WebKitu.
- `node scripts/reports-design-check.mjs` — **30 stávajících regresních scénářů prošlo**, včetně oprávnění pro viewer, exportu, tisku, vyhledání odběratele, chyb, načítání, opakování a měnících se částek.

Ověřené velikosti: 320×568, 360×740, 375×812, 390×844, 414×896, 430×932, 480×900, 600×960, 767×1024, 768×1024, 820×1180, 1024×768, 1280×800, 1440×900 a 1920×1080. Další kontrola ověřuje otevřený panel při výšce snížené na 360 px.

Snímky a výsledky jsou v `docs/redesign/visual-validation/mobile-reports/`, souhrnný náhled v `overview-390.png`. Výsledky stávající sady jsou v `docs/redesign/visual-validation/reports/validation.json`.

## G. Omezení

Nezůstala známá chyba v implementovaném rozsahu. Prohlížečové kontroly používají skutečné React komponenty a CSS s izolovanými testovacími API odpověďmi; neprováděly zápisy do živých finančních dat ani test přihlášení do produkčního tenant účtu. WebKit byl ověřen automatizovaně, ne na fyzickém telefonu. Uložení PDF probíhá prostřednictvím existující tiskové nabídky prohlížeče.
