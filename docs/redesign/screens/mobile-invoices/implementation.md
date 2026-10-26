# Mobilní faktury — implementace a ověření

Datum: 24. 10. 2026. Změny vzhledu jsou omezené na šířky **320–767 px**. Od 768 px zůstává dosavadní rozložení. Dashboard, archiv, globální navigace ani desktopové záhlaví se v tomto úkolu nemění.

## Implementované obrazovky

1. **Seznam faktur:** kompaktní řádky s odběratelem, číslem, přesnou částkou, splatností, stavem a nabídkou akcí. Průběh úhrady se zobrazuje pouze u částečně uhrazených faktur. Lokální hledání, rychlé stavy a filtry v přístupném modálním panelu používají původní stav a obsluhu filtrů. Hromadný výběr, oprávnění, řazení, export a stránkování zůstávají dostupné.
2. **Detail faktury:** čitelná hlavička s přesnou částkou a barvou podle stavu, hlavní platební akce a existující stažení/odeslání faktury. Záložky Přehled, Doklad, Platby a Upomínky zpřístupňují skutečné sekce aplikace. Údaje, kontakt, poznámky a historie zůstávají zachované. Odkazy na platby a upomínky otevřou příslušnou záložku.
3. **Nová ruční faktura:** tři kroky Faktura / Odběratel / Částka nad jediným původním formulářem. Přechod kontroluje povinné údaje daného kroku. Návrat zachovává hodnoty a ochranu neuložených změn. Uložení se spouští pouze posledním tlačítkem; přechody a dvojklik nezpůsobí předčasné či dvojité odeslání.
4. **Import:** přehledný výběr dokumentů nebo CSV, větší dotykové cíle, kompaktní nahrávání a seznam souborů. Druhotné vysvětlení je v rozbalovacím bloku. Skutečné formáty PDF/JPG/PNG/WEBP, limit 10 MB na soubor, upozornění, průběh, chyby a opakování importu zůstávají původní.
5. **Kontrola OCR:** kompaktní skutečný průběh importu, výběr dokumentu v dávce, záložky Údaje/Doklad, čitelné skupiny polí a skutečné stavy kontroly. Původní OCR confidence se zobrazuje pouze tam, kde je dostupné. Opravy, přeskakování, ukládání a rozepsané dávky používají původní logiku.

## Responzivní rozhodnutí

- Mezi 320 a 767 px jsou hlavní formulářová pole v jednom sloupci, vstupy mají písmo 16 px a hlavní dotykové prvky alespoň 44 px. Obsah přirozeně roluje; formulářové akce nepřekrývají pole při otevřené klávesnici.
- Seznam používá jednu datovou strukturu pro desktop i mobil. Doplňující e-mail, VS a vysvětlení splatnosti se neopakují v každém mobilním řádku; zůstávají v detailu.
- Filtry mají ikonové tlačítko s přístupným názvem. Nativní checkbox pro hromadný výběr zůstává funkční přes ikonu dokumentu.
- Smazání v mobilním detailu je v nabídce tří teček a stále vyžaduje původní potvrzení. Desktopové přímé tlačítko se nemění.
- Detail rozděluje existující panely do záložek. Sekce se nevytvářejí dvakrát a stav se při přepnutí neztrácí. Záložky podporují šipky na klávesnici a vazby ARIA.
- Seznam ponechává jedinou existující hlavní akci Nová faktura. Na mobilních stránkách detailu, nové faktury a importu jsou duplicitní stránkové panely akcí skryté; potřebné kontextové akce jsou přímo v obsahu. Globální logo, lupa, profil, notifikace a hamburger zůstávají beze změny.
- Nejsou přidané fiktivní položky faktury, duplikace ani odesílání upomínek, které produkční obrazovka nepodporuje. Používá se existující odeslání faktury e-mailem.
- Finanční hodnoty v detailu a řádcích zůstávají přesné. Neprovádí se změny účtovaných částek ani nahrazování dat ukázkami.

## Změněné soubory v tomto úkolu

Repozitář obsahoval další rozpracované změny již před tímto úkolem; následující seznam popisuje pouze tento mobilní redesign.

| Soubor | Účel změny |
| --- | --- |
| `src/app/(workspace)/invoices/invoices-client.tsx` | Zapojení mobilního obalu existujících filtrů. |
| `src/app/(workspace)/invoices/mobile-invoice-filters.tsx` (nový) | Lokální hledání, rychlé stavy a modální panel filtrů; od 768 px původní obal. |
| `src/app/(workspace)/invoices/mobile-invoices.module.css` (nový) | Mobilní rozložení hledání, filtrů a panelu. |
| `src/app/(workspace)/invoices/invoice-list-table.tsx` | Ikona dokumentu se zachovaným výběrem, označení částečných úhrad, oprava přístupného popisu částky. |
| `src/app/(workspace)/invoices/invoices.module.css` | Mobilní řádky, stav, částky, menu a stránkování. |
| `src/app/(workspace)/invoices/[id]/invoice-detail-client.tsx` | Mobilní rychlé akce a přesun smazání do menu při zachování obsluhy a potvrzení. |
| `src/app/(workspace)/invoices/[id]/invoice-detail-workspace.tsx` | Mobilní souhrn a přístupné záložky existujících panelů. |
| `src/app/(workspace)/invoices/[id]/invoice-detail.module.css` | Mobilní hlavička, akce, záložky a panely bez změny desktopových pravidel. |
| `src/app/(workspace)/invoices/new/page.tsx` | Mobilní návrat a zapojení stylů nové faktury. |
| `src/app/(workspace)/invoices/new/mobile-create.css` (nový) | Kompaktní mobilní nadpis a odstranění duplicitního panelu akcí. |
| `src/components/invoice-form.tsx` | Tříkrokové mobilní zobrazení nad původním stavem, validací a uložením. |
| `src/components/invoice-form-section.tsx` | Volitelné skrytí kroku bez odmountování a možnost zaměřit nadpis. |
| `src/components/mobile-invoice-form.module.css` (nový) | Mobilní kroky, pole, karty a tlačítka. |
| `src/app/(workspace)/invoices/import/page.tsx` | Mobilní sbalení druhotného vysvětlení importu. |
| `src/app/(workspace)/invoices/import/invoice-import.module.css` | Mobilní volba importu, soubory, dropzone a akce. |
| `src/app/(workspace)/invoices/import/ocr-review.module.css` | Mobilní průběh, dávka, záložky, dokument a spodní akce kontroly. |
| `src/components/invoice-review-form.module.css` | Mobilní rozložení skutečných OCR polí, upozornění a stavů. |
| `src/components/icons.tsx` | Doplnění ikony filtrů do existující sady. |
| `scripts/mobile-invoices-check.mjs` (nový) | Izolované prohlížečové scénáře pěti obrazovek, přetečení a porovnání s původním rozložením. |
| `scripts/invoices-design-check.mjs` | Aktualizace ovládání mobilních filtrů v regresním testu. |
| `scripts/invoice-detail-design-check.mjs` | Volba `--desktop-only` pro původní regresní scénáře; nový mobilní pohyb mezi panely ověřuje samostatná sada. |
| `docs/redesign/screens/mobile-invoices/implementation.md` | Tento implementační report. |
| `docs/redesign/visual-validation/mobile-invoices/*` | Původní a výsledné screenshoty, geometrie a seznam funkčních scénářů. |

## Zachovaná funkčnost

API routy, schémata validace, oprávnění, výpočty DPH a částek, stavy faktur, data formulářů a OCR ani schémata databáze se nemění. Mobilní prezentační vrstva používá stejné submit handlery, platební potvrzení, přiřazování a uvolňování plateb, přepínač upomínek, mazání s potvrzením, stažení dokumentu, odeslání faktury, filtry a importní workflow. Editace existující faktury nedostává nový průvodce.

## Skutečně provedené kontroly

- **Lint:** ESLint všech deseti dotčených TSX komponent/stránek, `--max-warnings 0`, prošel. Nejde o tvrzení o plošném lintu všech dříve rozpracovaných souborů repozitáře.
- **Typy:** `tsc --noEmit`, prošlo.
- **Build:** `APP_BASE_URL=https://www.splatno.com node scripts/next-clean-env.mjs build .cache/invoices-build --webpack`, prošel včetně typové kontroly a 86 rout. Bez nasazení.
- **Jednotkové testy:** 96 testů ve 13 souborech, prošlo. Pokrývají responzivní pravidla, formulář/DPH, detail a invalidaci cache, platby, seznam/filtry/součty/stránkování, oprávnění, OCR stavy a validaci dokumentů.
- **Nové mobilní funkční testy:** 17 scénářů prošlo. Zahrnují filtrování/hledání/reset/výběr, validaci kroků, zachování hodnot, měnu a DPH, přesně jedno uložení, selhání a opakování uložení, záložky detailu a potvrzení, opravy OCR a přepínání dávky, stavy zaplaceno/částečně/čekající/storno/čtenář/prázdný/dlouhé hodnoty, dlouhý název a odmítnutí nepodporovaného souboru bez uploadu.
- **Responzivní kontrola:** všech pět obrazovek na 320, 360, 375, 390, 414, 430, 480, 600, 767, 768, 1024, 1280, 1440 a 1920 px — **70 kontrol prošlo**, bez horizontálního přetečení a zachycených běhových chyb. Funkční scénáře zahrnují také krátký viewport 320 × 568.
- **Tablet/desktop:** 15 porovnání viditelné geometrie pěti obrazovek na 768, 1024 a 1440 px proti základu uloženému před implementací prošlo. Obsah zavřených nativních menu se z geometrického porovnání vyřazuje na obou stranách, protože Chromium někdy vrací přechodné rozměry neviditelných potomků. Funkčnost menu se testuje zvlášť. Nejde o automatické pixelové porovnání.
- **Původní seznam:** 5 vizuálních a 15 funkčních kontrol prošlo (`node scripts/invoices-design-check.mjs`).
- **Původní detail:** 19 kontrol prošlo (`node scripts/invoice-detail-design-check.mjs --desktop-only`), včetně původního rozložení, stavů a oprávnění, neroztahování historie při rozbalení upomínek, návratu z editace, obnovení náhledu, selhání zápisu upomínek, ruční úhrady, přiřazení částečné platby, uvolnění platby a potvrzení smazání.
- **Původní OCR:** 5 vizuálních a 13 funkčních kontrol prošlo (`node scripts/ocr-review-design-check.mjs`). Dalších 8 scénářů `--processing` ověřilo zpracování dávek, koncepty, přerušení, chyby, opakování a přeskočení.

## Výstupy a omezení ověření

[Snímky a naměřená geometrie](../../visual-validation/mobile-invoices/) obsahují `before-*` a `after-*`; [seznam mobilních funkčních kontrol](../../visual-validation/mobile-invoices/functional.json) uvádí skutečně dokončené scénáře. Ukázky: [seznam](../../visual-validation/mobile-invoices/after-list-390.png), [detail](../../visual-validation/mobile-invoices/after-detail-390.png), [nová faktura](../../visual-validation/mobile-invoices/after-manual-390.png), [import](../../visual-validation/mobile-invoices/after-import-390.png), [OCR](../../visual-validation/mobile-invoices/after-review-390.png).

Prohlížečové testy renderují skutečné komponenty v lokálním izolovaném prostředí s kontrolovanými API odpověďmi a testovacími dokumenty. Neproběhl přihlášený end-to-end test proti živému produkčnímu backendu ani test na fyzickém iPhonu/Androidu. Nativní vzhled a lokalizace date pickeru závisejí na prohlížeči/OS. Výběr souborů, virtuální klávesnice a VoiceOver nebyly ručně ověřeny na fyzickém zařízení. Nebyly provedeny produkční zápisy, migrace, nasazení ani commit.

## Následné doladění datumů a součtu

Datumové rozsahy ve filtrech mají plnou dostupnou šířku a samostatná pole Od/Do. Do 420 px jsou pod sebou, od 421 do 767 px vedle sebe; kalendář má vyhrazený prostor a text se nepřekrývá s ikonou. Součet je na mobilu v samostatné kartě s ikonou bankovky a popisem „Součet ve výběru“. Původní zkracování a zpřístupnění přesné částky zůstává zachované. Tlačítka panelu se vejdou i na 320 px.

Ověřeno: seznam na všech 14 šířkách včetně shody desktopové geometrie; zadání všech čtyř dat a jejich reset na 320, 390, 430, 600 a 767 px. Cílený ESLint a `tsc --noEmit` prošly. Pro toto doladění nebyl znovu spouštěn produkční build ani celá sada jednotkových testů. Screenshoty filtrů jsou ve výstupech jako `date-filters-*.png`.

## Následné doladění potvrzovacího panelu OCR

Mobilní panel má jednotnou bílou kartu, klidný pokyn „Před uložením“ s ikonou dokumentu, hlavní tlačítko uložení přes celou šířku a méně výrazné přeskočení pod ním. Rozhraní neinterpretuje OCR údaje jako ověřené; původní výzva ke kontrole zůstává. Submit, disabled/saving stav i přeskočení nadále používají stejné handlery. Úpravy jsou v `invoice-form.tsx`, `invoice-review-form.module.css` a `import/ocr-review.module.css`. Cílený ESLint a typová kontrola prošly; kontrola obrazovky prošla na 14 šířkách včetně porovnání původní geometrie od 768 px. Produkční build ani celá testovací sada se pro tuto prezentační změnu znovu nespouštěly.

## Následné doladění ovládání dokumentu

Mobilní náhled dokumentu má oddělený název souboru (až dva řádky), metadata a dvě zarovnané skupiny ovládání. Stránkování má správné pořadí předchozí / počet stran / další; zoom kompaktní ovládání a přizpůsobení šířce. Od 480 do 767 px se skupiny zobrazují vedle sebe. Návrat k údajům má šipku a lehčí vzhled. Změněny `import/ocr-review-workspace.tsx` a `import/ocr-review.module.css`; logika náhledu a OCR zůstává původní. Prošly cílený ESLint, typová kontrola a původní OCR prohlížečová sada (5 viewportů a 13 funkčních scénářů včetně stránek, zoomu a zachování oprav). Výsledný náhled je v `visual-validation/ocr-review/mobile-document.png`.

## Zkompaktnění mobilního součtu

Předchozí velkou kartu součtu nahrazuje štítek vedle nadpisu s 20px ikonou bankovky, menším odsazením a šířkou podle obsahu. Viditelný pomocný popis je skrytý; přístupný název součtu a původní detail přesné částky zůstávají zachované. Pokud vedle nadpisu není místo, štítek se přirozeně přesune na další řádek bez roztažení přes celou šířku. Změna je pouze v mobilních pravidlech `invoices.module.css`. Seznam prošel kontrolou všech 14 šířek a porovnáním původní desktopové geometrie.

## Sjednocení vzhledu OCR uploadu s bankovními výpisy

Nahrávací plocha OCR převzala vizuální styl bankovního uploadu: stejné barvy, zaoblení, přerušovaný rámeček, centrovanou ikonu dokumentu, plné zelené tlačítko a formátové štítky. Desktop má nahrávání vlevo a vysvětlení v zeleném pravém panelu; tablet skládá vysvětlení pod nahrávání a mobil používá kompaktní rozbalovací kartu. Mobilní volba způsobu importu je menší segmentované ovládání. OCR formáty PDF/JPG/PNG/WEBP, limit 10 MB, sdělení o externí AI, výběr více souborů, přetažení, potvrzení nahrání, zpracování a kontrola údajů zůstávají zachované. Výpočty ani API se nemění.

Změněny pouze prezentační části `import/page.tsx`, `import/invoice-import.module.css` a přidán výslovný přepínač `--ocr-upload-redesign` ve vizuálním skriptu pro úmyslně změněnou obrazovku importu; původní základ nebyl přepsán. Prošly cílený lint, `tsc --noEmit`, 14 responzivních snímků bez přetečení, OCR regresní sada (5 viewportů / 13 scénářů) i 8 zpracovacích scénářů `--processing`. Produkční build nebyl v tomto doladění znovu spuštěn. Výstupy: `visual-validation/mobile-invoices/after-import-*.png`.
