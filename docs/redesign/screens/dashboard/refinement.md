# SPL-DASH-001 — single-screen refinement, 18. 10. 2026

Výslovné doplnění uživatele: optimalizovat desktop dashboard na 1536 × 1024 a 1440 × 900 px. Menší viewporty, delší data, rozbalené detaily a zvětšení mohou přirozeně scrollovat. Neupravovat globální overflow, backend, auth, API ani účetní výpočty.

## Zjištěné příčiny

Předchozí implementace měla velkou spodní rezervu, příliš vysoké seznamy s vlastním scrollem a dlouhé jednotlivé upomínky. Při užším desktopu navíc container breakpoint skládal donut nad legendu a zvyšoval celou řadu grafů. Srovnána dodaná reference 1536 × 1024 a předchozí implementace; předchozí snímky zachované v `artifacts/dashboard-design/refinement-before-{chromium,webkit}`.

## Implementace

- Pět hlavních řad CSS Grid na dostatečně velkém desktopu: topbar, uvítání, KPI, grafy, pracovní panely. Výška viewportu je rozpočet pro dva spodní minmax řádky; min-content minima mají přednost před kompresí nebo oříznutím. Celá stránka má automatickou výšku i na desktopu, aby WebKit správně aktualizoval rozsah scrollování při delším obsahu. Výška není globálně uzamčená a vnitřní scroll panely byly odstraněné.
- Čtyři skutečné poslední faktury, tři skutečné nejbližší plánované upomínky. Celý seznam faktur dostupný původním odkazem, další načtené upomínky lze rozbalit i jako viewer. Nastavení upomínek pouze pro oprávněnou roli. Žádná fiktivní historie odeslání.
- Stejná výška panelů v každé desktopové řadě; pod 1440 px spodní panely pod sebou. Mobilní faktury v přirozeném toku jako karty.
- Období grafu vpravo v uvítání; stále řídí pouze existující report, nikoli KPI ani seznamy. Měna zůstává v grafu. Search funguje přes Enter a má klávesnicí dostupný submit, bez výrazné dekorativní šipky.
- Čitelnější sekundární typografie, širší prostor pro KPI poznámky. Skutečné hodnoty grafu na hover i focus, včetně tabulkové alternativy. Legenda zachovává disjunktní stavy a původní finanční definice.
- Eško na desktopu v prostoru sidebaru nad profilem, aby nepřekrýval důležité odkazy. Na mobilu původní malé plovoucí tlačítko.

## Ověření

Aktuální měření, screenshoty a výsledky kontrol jsou v `refinement-verification.json`. Screenshoty mají vždy v názvu šířku i výšku, aby se dvě výšky stejné šířky nepřepisovaly.

Browser fixture vykresluje skutečné React komponenty a CSS s blokovanou externí sítí a syntetickými read-only odpověďmi. Není to nové přihlášené produkční E2E. Test zvětšení používá CSS zoom 200 %, nikoli deklarovaný audit všech kombinací skutečného browser zoomu a asistivních technologií. Produkční build běží v izolované kopii se syntetickou konfigurací.

Implementováno ve větvi `design-rebuild`, bez commitu, pushnutí nebo nasazení na main. Vizuální akceptace uživatelem zbývá.

## Referenční screenshoty

| Viewport | Celá stránka v běžném stavu | Screenshot Chromium |
| --- | --- | --- |
| 1536 × 1024 | Bez vertikálního scrollu | [Snímek](../../../../artifacts/dashboard-design/refinement-chromium/normal-1536x1024.png) |
| 1440 × 900 | Bez vertikálního scrollu | [Snímek](../../../../artifacts/dashboard-design/refinement-chromium/normal-1440x900.png) |
| 1280 × 800 | Přirozený vertikální scroll | [Snímek](../../../../artifacts/dashboard-design/refinement-chromium/normal-1280x800.png) |
| 390 × 844 | Přirozený vertikální scroll | [Snímek](../../../../artifacts/dashboard-design/refinement-chromium/normal-390x844.png) |

Všechny čtyři mají čitelný obsah a žádný horizontální overflow. Odpovídající WebKit snímky jsou ve složce `refinement-webkit` se stejnými názvy.

## Kontroly a omezení

- Celá sada: `corepack pnpm exec vitest run src --maxWorkers=2` — 200 souborů, 1 716 testů prošlo. První neomezený paralelní běh měl tři OCR timeouty při souběhu s browsery/buildem; všech 14 OCR testů následně prošlo samostatně a celý omezeně paralelní běh prošel bez změny OCR kódu nebo timeoutů.
- Lint a TypeScript prošly; produkční webpack build v izolované kopii prošel. Komponentní testy nově pokrývají limitované náhledy, rozbalení plánovaných akcí pro viewer a skutečné částky v klávesnicovém grafu.
- Browser kontroly: 35 scénářů v každém enginu. Kromě cílových rozměrů zahrnují hranice responsivity, viewer, prázdná data, dlouhé názvy/velké částky a chybu reportu. Speciálně kontrolují tooltip, rozbalení tabulky, rozsah posuvné plochy, žádné překrytí sekcí a CSS zoom 200 %.
- Jedna WebKit kontrola původně odhalila špatně rostoucí rozsah scrollování při pevné výšce gridu. Opraveno automatickou výškou stránky s viewportovými minmax řádky; kontrola nyní ověřuje také dostupnost spodních panelů v rozsahu dokumentu.
