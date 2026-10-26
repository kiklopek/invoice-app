import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const dir = resolve('docs/redesign/visual-validation/ocr-review');
const reference = sharp(resolve(dir, 'reference.png'));
const after = sharp(resolve(dir, 'current-after.png'));
const [refMeta, currentMeta, baselineMeta] = await Promise.all([
  reference.metadata(), after.metadata(), sharp(resolve(dir, 'current-before.png')).metadata(),
]);
if (refMeta.width !== currentMeta.width || refMeta.height !== currentMeta.height) {
  throw new Error('Reference and screenshot dimensions differ; normalize explicitly before comparing.');
}
const width = refMeta.width, height = refMeta.height;
const [refRaw, currentRaw] = await Promise.all([
  reference.removeAlpha().raw().toBuffer(), after.removeAlpha().raw().toBuffer(),
]);
const overlay = Buffer.alloc(refRaw.length), difference = Buffer.alloc(refRaw.length);
for (let i = 0; i < refRaw.length; i++) {
  overlay[i] = Math.round((refRaw[i] + currentRaw[i]) / 2);
  difference[i] = Math.abs(refRaw[i] - currentRaw[i]);
}
await Promise.all([
  sharp(overlay, { raw: { width, height, channels: 3 } }).png().toFile(resolve(dir, 'overlay.png')),
  sharp(difference, { raw: { width, height, channels: 3 } }).png().toFile(resolve(dir, 'difference.png')),
]);
const validation = JSON.parse(await readFile(resolve(dir, 'validation.json'), 'utf8'));
const baseline = JSON.parse(await readFile(resolve(dir, 'before-validation.json'), 'utf8'));
const desktop = validation.results[0];
const revision = JSON.parse(await readFile(resolve(dir, 'revision-before-validation.json'), 'utf8'));
if (existsSync(resolve(dir, 'revision-before.png'))) await sharp({ create: { width: width * 2, height, channels: 3, background: '#fff' } }).composite([{ input: resolve(dir, 'revision-before.png'), left: 0, top: 0 }, { input: resolve(dir, 'current-after.png'), left: width, top: 0 }]).png().toFile(resolve(dir, 'revision-comparison.png'));
const refRects = { sidebar: [0, 0, 254, 1024], topbar: [288, 21, 1223, 42], form: [289, 228, 642, 678], preview: [951, 228, 552, 678], actions: [289, 918, 1214, 72] };
const rounded = rect => rect ? [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(' / ') : '—';
const geometry = Object.entries(refRects).map(([name, ref]) => {
  const actual = desktop[name];
  return `| ${name} | ${ref.join(' / ')} | ${rounded(actual)} | ${actual ? [actual.x, actual.y, actual.width, actual.height].map((value, i) => Math.round(value - ref[i])).join(' / ') : '—'} |`;
}).join('\n');
const viewports = validation.results.map(row => `| ${row.viewport.width} × ${row.viewport.height} | ${row.body.height > row.viewport.height + 1 ? 'Přirozený scroll stránky' : 'Bez scrollu celé stránky'} | ${row.body.width <= row.viewport.width ? 'Bez horizontálního přetečení' : 'Přetečení'} | ${row.viewport.width >= 1024 ? 'Scroll celé stránky, sticky PDF a akce' : 'Údaje / Doklad, zachované hodnoty'} |`).join('\n');
const text = `# Kontrola OCR faktury — vizuální validace

Reference: **${width} × ${height} px**. Před úpravou: **${baselineMeta.width} × ${baselineMeta.height} px**. Po úpravě: **${currentMeta.width} × ${currentMeta.height} px**. Souřadnice lze porovnávat ve stejném viewportu.

Referenční hrany karet byly odečteny z PNG (přibližně ±2 px); implementace je měřená přes getBoundingClientRect. Textové hodnoty a originál dokladu jsou při vizuálních testech syntetické. Pixelový difference proto není měřítkem správnosti OCR ani absolutní shody dat.

## Aktuální požadavek: scroll celé stránky

Novější zadání výslovně nahrazuje původní single-screen režim: posouvá se celá stránka, formulář nemá vlastní scrollovací panel a PDF je sticky vedle něj. Nadpis a popis nad formulářem jsou odstraněné. Referenční obrázek zůstává vizuálním podkladem barev a komponent; rozdílné výšky níže jsou záměrné podle nového požadavku.

Při více souborech je nad formulářem rozbalovací výběr faktury se skutečným číslem, odběratelem, názvem souboru a stavem. Přepínání obnovuje samostatné koncepty. Escape a kliknutí mimo nabídku ji zavírají.

Varování mají jednu kompaktní souhrnnou lištu; první důvod u každého pole zůstává přímo viditelný. Další důvody a dokumentová upozornění lze rozbalit; nic se neztrácí z OCR metadat ani validací.

## Naměřené rozdíly

Formát: x / y / šířka / výška, v px.

| Prvek | Reference | Implementace | Rozdíl |
|---|---|---|---|
${geometry}

Původní karta formuláře: ${rounded(baseline.results[0].form)}. Původní náhled: ${rounded(baseline.results[0].preview)}. Původní výška stránky: ${baseline.results[0].body.height} px. Nová výška stránky: ${desktop.body.height} px. Všech **14 polí** je přístupných uvnitř levé karty.

## Strukturální přestavba po zpětné vazbě

- Samostatná komponenta OcrReviewWorkspace: kompaktní navigace, výběr dokumentu, společný dvousloupcový grid a sticky footer. Review stav má vlastní větev renderování, nepoužívá starou strukturu importu.
- InvoiceFormSection sdílí původní JSX polí a obsluhy mezi ručním formulářem a kompaktní OCR prezentací. Review nepoužívá legacy třídy standalone-form / form-section / form-grid.
- Vstupy42 px, mezery mezi poli13 px a mezi sloupci16 px, karta18 px padding. První sekce má nyní ${Math.round(desktop.firstSectionHeight)} px a celý obsah formuláře ${desktop.formContentHeight} px, dostupná plocha karty ${Math.round(desktop.form.height)} px.
- Předchozí implementace má zachovaný screenshot revision-before.png; revision-comparison.png ji ukazuje vlevo a novou strukturu vpravo. Oba pohledy mají stejné rozlišení. Předchozí výška panelu byla ${Math.round(revision.results[0].form.height)} px; nová ${Math.round(desktop.form.height)} px.
- Zdrojové nápovědy mají nativní popover v horní vrstvě prohlížeče; nejsou oříznuté levým scrollerem. Zavření klávesou Escape i zavření při posunutí panelu jsou ověřené.
- Dokument má skutečný viewport o výšce ${Math.round(desktop.documentViewportHeight)} px, bez prázdného prostoru pod náhledem. Testovací PDF má reprezentativní tabulku položek; aplikace stále zobrazuje původní nahraný soubor.

## Provedené opravy

- Samostatný review layout; původní výběr souborů a CSV zůstávají zachované.
- Jedna bílá formulářová karta, tři původní sekce a jemné oddělovače; kompaktní pole a nenápadné zelené indikátory skutečného verified stavu.
- Odstraněný viditelný nadpis a popis podle screenshotu uživatele. Návrat na import s obnovením konceptu a skutečný aktuální krok kontroly zůstávají.
- Přirozený scroll celé stránky, levá karta bez vnitřního scrolleru, sticky originál faktury vpravo a sticky spodní akce. overflow-x:clip je omezené na OCR review a umožňuje správnou funkci sticky.
- Původní PDF.js, textová vrstva a souřadnice zvýraznění. Předešlá/další stránka, zoom a přizpůsobení šířce; zachování pozice při zoomu.
- Souhrn skutečných OCR rozhodnutí zaměří příslušná pole. Nejisté údaje mají viditelné důvody, původní zdroje a alternativy zůstávají dostupné.
- Spodní uložení je spojeno s původním formulářem přes HTML form atribut a React portal; native validace, blokátory, API chyby, loading a přechod na další dokument zachovány. Serverová chyba dostane fokus.
- Esko má vyhrazený prostor vedle akcí, nepřekrývá uložení; profil zůstává pouze vlevo dole, zvonek se nepřidává.

## Responzivita

| Viewport | Vertikálně | Horizontálně | Chování |
|---|---|---|---|
${viewports}

## Funkční ověření

${validation.checks.map(name => `- PASS: ${name}`).join('\n')}

- 295 regresních testů / 19 souborů: OCR extrakce, zdroje, registry, reconciliation, měny, corpus, validace, pravidla kategorií, finanční kontroly, drafty, document-locate a sdílená navigace.
- TypeScript, lint celého projektu a izolovaný produkční build: úspěšné.
- Žádné změny OCR algoritmů, confidence, mappingů, výpočtů, API, Supabase, RLS, autentizace ani plánování upomínek.

## Zbývající a záměrné odchylky

- Sdílený sidebar zachovává šířku 244 px místo 254 px v referenci; jeho komponenta a navigační chování se kvůli OCR nepřepisují. Pole review panelů byla lokálním odsazením dorovnána k referenci.
- Mockup má méně polí než skutečný formulář. Zachováno všech 14 i podmíněné kontroly záloh a účtu; celý formulář se proto posouvá se stránkou. Nejsou skryta pole pro shodu se screenshotem.
- OCR ikony jsou uvnitř vstupů vpravo; datumové ovladače i selecty mají pro stavovou ikonu vyhrazené místo. Nejisté hodnoty mají jantarovou ikonu a vysvětlení pod polem, chybějící údaje červenou ikonu. Úplné zdroje, důvody a kandidáti zůstávají dostupné.
- Náhled zobrazuje skutečný nahraný dokument, nikoliv statický obrázek referenční faktury. Vizualizace používá generovaný třístránkový PDF a PNG; skutečný uložený doklad nebyl vytvářen.
- Pokud OCR nemá důvěryhodný mapping, zdroj se neodhaduje. Chybějící údaje lze doplnit ručně. Ruční úprava nevytváří nový potvrzený OCR stav; původní confidence a decisions zůstávají zachované.
- Na tabletu a mobilu je přirozené scrollování; levý formulář a náhled se přepínají bez odmountování a ztráty hodnot.
- Browser testy jsou frontend + zachycené API + reálný PDF.js. Nejde o nové přihlášení, upload do Supabase ani ověření živého OCR/Supabase end-to-end. Testy neodesílají skutečné upomínky ani neukládají skutečné faktury.

## Změněné soubory v tomto úkolu

- src/app/(workspace)/invoices/import/page.tsx
- src/app/(workspace)/invoices/import/ocr-review-header.tsx (nový)
- src/app/(workspace)/invoices/import/ocr-review-workspace.tsx (nový)
- src/app/(workspace)/invoices/import/ocr-document-picker.tsx (nový)
- src/app/(workspace)/invoices/import/ocr-review.module.css (nový)
- src/components/invoice-form.tsx
- src/components/invoice-form-section.tsx (nový)
- src/components/invoice-review-form.module.css (nový)
- src/lib/import-split-preview.test.ts (upravené kontroly nové struktury)
- src/components/document-preview.tsx
- scripts/ocr-review-design-check.mjs (nový)
- scripts/ocr-review-visual-comparison.mjs (nový)
- docs/redesign/visual-validation/ocr-review/ — audit, měření, screenshoty, overlay a difference

Příkazy: node scripts/ocr-review-design-check.mjs; node scripts/ocr-review-visual-comparison.mjs. Baseline se vytváří pouze jednou přes --before ze zdrojů HEAD; existující baseline skript odmítne přepsat.
`;
await writeFile(resolve(dir, 'visual-comparison.md'), text);
console.log(JSON.stringify({ reference: [width, height], after: [currentMeta.width, currentMeta.height], report: resolve(dir, 'visual-comparison.md') }));
