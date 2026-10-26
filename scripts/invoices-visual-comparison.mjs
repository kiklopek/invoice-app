import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
const dir=resolve('docs/redesign/visual-validation/invoices');
const reference=await sharp(resolve(dir,'reference.png')).removeAlpha().raw().toBuffer({resolveWithObject:true});
const current=await sharp(resolve(dir,'after-desktop.png')).removeAlpha().raw().toBuffer({resolveWithObject:true});
if(reference.info.width!==current.info.width||reference.info.height!==current.info.height)throw new Error('Reference and current viewport must match before comparison');
const {width,height}=reference.info;
const overlay=await sharp(current.data,{raw:{width,height,channels:3}}).ensureAlpha(.5).png().toBuffer();
await sharp(reference.data,{raw:{width,height,channels:3}}).composite([{input:overlay}]).png().toFile(resolve(dir,'overlay.png'));
const difference=Buffer.alloc(reference.data.length);let totalDifference=0;
for(let i=0;i<difference.length;i++){difference[i]=Math.abs(reference.data[i]-current.data[i]);totalDifference+=difference[i]}
await sharp(difference,{raw:{width,height,channels:3}}).png().toFile(resolve(dir,'difference.png'));
const data=JSON.parse(await readFile(resolve(dir,'validation.json'),'utf8'));
const before=await sharp(resolve(dir,'before.png')).metadata();
const desktop=data.results[0].metrics;
function titleInk(buffer){let x1=width,y1=height,x2=0,y2=0;for(let y=135;y<185;y++)for(let x=300;x<950;x++){const i=(y*width+x)*3;if(buffer[i]<90&&buffer[i+1]<90&&buffer[i+2]<90){x1=Math.min(x1,x);y1=Math.min(y1,y);x2=Math.max(x2,x);y2=Math.max(y2,y)}}return{x:x1,y:y1,width:x2-x1+1,height:y2-y1+1}}
const currentInk=titleInk(current.data),referenceInk=titleInk(reference.data);
const round=value=>Math.round(value*10)/10;
const box=value=>value?`${round(value.x)}, ${round(value.y)} · ${round(value.width)} × ${round(value.height)}`:'—';
const refs={sidebar:{x:0,y:0,width:254,height:1024},topbar:{x:285,y:20,width:1218,height:44},heading:referenceInk,summary:{x:1215,y:138,width:288,height:76},filters:{x:286,y:239,width:1217,height:109},table:{x:286,y:348,width:1217,height:550},footer:{x:286,y:898,width:1217,height:82}};
const labels={sidebar:'Sidebar',topbar:'Topbar',heading:'H1 (vykreslený text)',summary:'Souhrnná karta',filters:'Základní filtry',table:'Tabulka včetně záhlaví',footer:'Stránkování'};
const measurements=Object.entries(refs).map(([key,ref])=>{const measured=key==='heading'?currentInk:desktop[key];return `| ${labels[key]} | ${box(ref)} | ${box(measured)} | ${measured?`${round(measured.x-ref.x)} / ${round(measured.y-ref.y)} / ${round(measured.width-ref.width)} / ${round(measured.height-ref.height)}`:'—'} |`}).join('\n');
const viewports=data.results.map(({width,height,metrics,errors,file})=>`| [${width} × ${height}](${file}) | ${metrics.document.height>height+1?'Ano, přirozený':'Ne'} | ${metrics.document.width>width+1?'CHYBA':'Ne'} | ${width<768?'Karty, rozbalovací filtry':width<1440?'Tabulka, posun pouze uvnitř tabulky':'Plná tabulka'} | ${errors.length?'CHYBA':'Prošlo'} |`).join('\n');
const columns=desktop.columns.map(col=>`| ${col.label||'Výběr / akce'} | ${round(col.x)} | ${round(col.width)} |`).join('\n');
await writeFile(resolve(dir,'validation-report.md'),`# Faktury — vizuální a funkční validace

Větev: \`design-rebuild\`. Bez commitu, pushnutí a změn produkčních dat. Referencí je uživatelem dodaný čistý mockup \`faktury.png\`, nikoli screenshot původního rozhraní s lištou prohlížeče.

## Obrázky a metoda

- Reference: **${width} × ${height} px**. Před úpravou: **${before.width} × ${before.height} px**. Po úpravě: **1536 × 1024 px**. Porovnání používá shodné rozměry, žádné přepočítávání souřadnic různě velkých obrázků.
- [Reference](reference.png), [před úpravou](before.png), [po úpravě](after-desktop.png), [50% overlay](overlay.png), [absolutní RGB difference](difference.png).
- Playwright vykresluje **skutečné React komponenty AppShell, WorkspaceTopbar, InvoicesClient a jejich CSS** přes lokální Vite fixture. Síť vrací izolovaná syntetická data ve skutečném API formátu. Soukromá data ani autentizace se pro screenshoty nevytvářejí a nemění.
- **Nejde o přihlášený end-to-end test Next.js → Supabase.** Produkční komponenta stále používá skutečný serverový loader a existující API. Z prohlížečových fixture nelze odvozovat potvrzení funkčnosti produkčního přihlašování, RLS ani odesílání upomínek.
- Obrazový rozdíl porovnává i jiné hodnoty, e-maily a organické pozadí; není skórem designové shody. Průměrný absolutní RGB rozdíl: ${(totalDifference/difference.length).toFixed(2)} / 255.

## Naměřené rozložení při 1536 × 1024

Reference je změřena z rastrového obrázku přibližně (tolerance ±2 px). Implementace je změřena z DOM. Výjimkou je H1: u obou obrázků se měří přímo tmavé pixely písma v oblasti nadpisu (RGB < 90), nikoli šířka celého blokového elementu. Zápis: x, y · šířka × výška. Delta: x / y / šířka / výška.

| Oblast | Reference (px) | Implementace (px) | Delta (px) |
| --- | --- | --- | --- |
${measurements}

Původní dokument měl při stejných osmi testovacích fakturách výšku 1769 px. Nový dokument má ${desktop.document.height} px. Výška se neomezuje ani neořezává: při více fakturách, zvětšení textu nebo menším viewportu se stránka přirozeně prodlužuje.

### Sloupce implementace

| Sloupec | x (px) | Šířka (px) |
| --- | --- | --- |
${columns}

## Provedené úpravy

1. Společná horní lišta pro interní stránky přes AppFrame; dashboard využívá stejnou komponentu se svými schválenými rozměry. Vyhledávání nadále okamžitě hledá faktury, klienty i platby. Profil zůstává pouze vlevo dole. Rozbalené desktopové podmenu se na /invoices nezobrazuje; import a přidání jsou v topbaru, archiv a bankovní platby v nabídce akcí.
2. Hlavička „Všechny faktury“ a kompaktní částková karta bez nadpisu, ikony, šipky či nabídky. Podle posledního požadavku jde o součet celkových částek **všech faktur odpovídajících všem filtrům**, včetně zaplacených, napříč stránkami. Měny se zobrazují odděleně. Samostatný autorizovaný GET /api/invoices/totals využívá stejné existující RPC a společné parametry jako seznam, čte po dávkách 500 a sčítá haléře pomocí bigint. Databázové schema ani oprávnění se nemění. Součet má samostatný SWR klíč bez stránky a její velikosti, aktualizuje se při změně filtrů i invalidaci po úhradě a načítá se také při SSR. Chyba součtu neblokuje seznam a má vlastní opakování požadavku. Náklady výpočtu rostou s počtem odpovídajících faktur; nenačítá se znovu při pouhém stránkování ani při globálním vyhledávání.
3. Základní stav, Seřadit podle a dvě rozmezí dat. Měna je podle následného požadavku uživatele přesunuta do Dalších filtrů spolu s místním hledáním, částkami a stavem úhrady / bankovního párování. Výběr řazení a klikání na záhlaví tabulky používají společný stav; řazení se vztahuje na aktuální stránku. Aktivní hodnoty jsou viditelné, reset smaže všechny původní parametry. Zavření rozšířené části hodnoty nemaže. Export používá původní logiku a parametry.
4. Sémantická tabulka se skutečnými částkami a měnami, VS, kontaktem, datumy, stavem a průběhem úhrad. Částky mají haléře, výpočty se předem nezaokrouhlují. Relativní splatnost vychází z pražského kalendářního data; model faktur nedostává ilustrační stav „Plánováno“.
5. Výběr má funkční akci kopírování čísel do schránky, včetně select-all / indeterminate / zrušení výběru. Portálové nabídky řádků se drží v obrazovce, zavírají Escape a vracejí fokus. Otevření detailu, kopírování VS, platby, upomínky a původní dialog potvrzení úhrady zůstávají dostupné podle oprávnění. Editace, storno a smazání zůstávají v původním detailu se stávajícími potvrzeními.
6. Patička s počtem výsledků a stránkami nabízí 10, 25, 50 a 100 položek. Výchozí počet je 25; další volbu uchovává roční cookie v prohlížeči, kterou odhlášení nemaže. Server preference načítá před prvním renderem. Změna velikosti vrátí seznam na první stránku a zachová filtry. Skeleton odpovídá tabulce. Existuje prázdný stav, žádný výsledek i chyba s opakováním požadavku.
7. Jeden globální Esko; na fakturách větší ilustrace, stávající zavření a bookmark. Stránkování má bezpečný prostor vůči widgetu. Mobilní menu nadále funguje.
8. Databázové schema, RLS, autentizace, párování, odesílání, exportní výpočty a oprávnění zůstávají zachované. Následný požadavek uživatele rozšířil dotaz seznamu o validovaný parametr page_size (10/25/50/100), předávaný do existujícího RPC bez databázové migrace. Existující změny z předchozích úkolů zůstaly zachované.

## Responzivita

| Screenshot | Vertikální scroll | Horizontální overflow dokumentu | Rozložení | Výsledek |
| --- | --- | --- | --- | --- |
${viewports}

Doplňky: [celý mobilní dokument](after-mobile-full.png), [velké částky a dlouhé názvy](state-stress.png), [čtenář](state-viewer.png), [prázdná organizace](state-empty.png). Vysoké finanční hodnoty jsou kontrolovány i podle skutečné pozice vykresleného textu vůči hranicím sloupce.

### Dodatečná oprava souhrnné karty

Karta nyní podle dalšího požadavku zobrazuje pouze částku, bez viditelného nadpisu, ikony, šipky a klikací nabídky. Částka a měna zůstávají na jednom řádku. Playwright kontroluje souřadnice textu vůči okrajům při 320, 390, 768, 1280 a 1536 px s částkou 7 999 999 999,92 Kč. [Telefon 320 px](summary-large-320.png), [desktop](summary-large-1536.png).

## Funkční ověření a jeho hranice

- Playwright Faktury: **5 viewportů + ${data.functional.length} funkčních scénářů**, bez chyb. Výběr, schránka, řazení aktuální stránky, kombinace parametrů, vyhledávání bez diakritiky, reset, exportní download, potvrzovací podmínka úhrady, loading/error/retry, 3 stránky po výchozích 25 z 58 položek, změna velikosti na 10 a 50 včetně resetu stránky a přetrvání přes reload, viewer, empty/stress a mobilní menu / patička.
- Export je v prohlížeči ověřen jako správně filtrovaný požadavek a download; syntetická odpověď není validací skutečného obsahu XLSX. Původní exportní implementace se neměnila.
- Potvrzení úhrady v prohlížeči používá pouze lokální simulovaný PATCH. Původní unit regresní testy navíc ověřují **částečnou i úplnou bankovní úhradu a invalidaci cache**; žádná reálná faktura nebyla změněna.
- Regrese sdíleného layoutu / dashboardu: **57 prohlížečových kontrol prošlo** (\`artifacts/dashboard-design/invoices-topbar-chromium/results.json\`, podle výstupu skriptu).
- \`pnpm typecheck\`: prošlo. \`pnpm lint\`: prošlo. \`git diff --check\`: prošlo.
- Produkční build Next 16.3.8 (webpack): prošel v odděleném \`.cache/invoices-build\`; lokální HTTPS APP_BASE_URL pouze pro validaci buildu, bez nasazení a změny běžícího vývoje. Původní pokus narazil na omezenou síť pro existující Google Fonts, opakovaný build se sítí prošel.
- Poslední celoběh před doplněním volby velikosti stránky \`pnpm test\`: **1851 prošlo / 1 selhal** (214 souborů). Zbývající test \`src/lib/api-error-identity.test.ts\` hlídá počet rout s neobalenou chybou 5xx: stávající globální vyhledávání \`/api/search\` z předchozí práce přidává čtvrtou routu k limitu tří. Je to samostatná dřívější backendová odchylka, v této UI migraci není opravována ani maskována změnou limitu.
- Generované fixture a izolovaný build jsou vyloučeny z lintu / discovery testů přes \`.cache/**\`, aby se testy symlinkované kopie nespouštěly dvakrát.

## Zbývající odchylky vůči mockupu

- Sdílený sidebar má **244 px**, reference 254 px; zůstává stejný jako schválený dashboard. Vnější odsazení obsahu tento rozdíl na desktopu kompenzuje.
- **Žádný horní avatar ani zvonek**: jde o dřívější výslovné rozhodnutí uživatele, ne o chybějící implementaci.
- Reference ilustruje 8 položek; podle následného požadavku uživatele je nyní dostupná volba **10/25/50/100 na stránku**, přetrvávající po refreshi a odhlášení v témže prohlížeči po dobu roku. Nejde o synchronizaci nastavení mezi zařízeními.
- Nové klikací řazení se týká **aktuální stránky** a je tak označeno. Backend nemá parametr pro globální řazení a nebyl rozšiřován. Datum vystavení je dostupné v nabídce faktury; není přidán samostatný sloupec mimo referenci.
- Částková karta se po následné úpravě uživatele od reference záměrně liší: obsahuje pouze součet všech filtrovaných faktur; původní titulek, šipka, ikona i nabídka byly odstraněny.
- Tabulkové hodnoty používají 13 px a pomocné texty 12 px; předloha působí u hlavních hodnot přibližně o 1 px větší. Částky a dlouhé hodnoty tak zůstávají čitelné i na notebooku bez překrytí sloupců.
- Date range používá přístupné nativní date inputy a kalendáře. Jejich zobrazení data se řídí prohlížečem / operačním systémem; není nasazen nový vlastní datepicker jen kvůli rasterové shodě.
- Reálné stavy, počty a splatnosti mají přednost před ilustračními a místy nekonzistentními hodnotami reference. Samotný rozdíl hodnot se nepovažuje za designovou vadu.
- Organické pozadí a ilustrace Eska pocházejí ze sdílených již existujících assetů; nejsou nahrazeny rastrem mockupu. Footer ponechává bezpečný odstup od plovoucího widgetu.

Doplnění 20. 10. 2026: unit testy parseru, SSR preference, logout a platebního toku **10/10 prošlo**; Playwright **5 viewportů + 12 funkčních scénářů**, TypeScript, lint a izolovaný produkční build prošly.

Dodatečné řazení: výběr místo Měny, synchronizace se záhlavím a reset pořadí ověřeny v Playwrightu; cílené unit/regresní testy **27/27**, TypeScript a lint prošly.

Sumarizace podle filtrů: **39/39** cílených unit/regresních testů (dávkování přes 500 faktur, oddělené měny, filtry, přístupová identita, chyby, platební tok a cache) prošlo. Playwright **5 viewportů + 13 scénářů**, včetně součtu napříč stránkami, nenulového výsledku pro zaplacené faktury a opakování po chybě. TypeScript, lint a produkční build prošly.

## Soubory této UI migrace

- \`src/app/(workspace)/invoices/{page.tsx,invoices-client.tsx,loading.tsx,invoices.module.css}\`
- \`src/app/(workspace)/invoices/{invoice-list-table.tsx,invoice-row-actions.tsx,invoice-list-presentation.ts,invoice-list-skeleton.tsx}\`
- \`src/app/(workspace)/invoices/[id]/invoice-detail-client.tsx\` — pouze kotvy pro existující sekce.
- \`src/components/layout/{app-shell.tsx,workspace-topbar.tsx,workspace-topbar.module.css,invoices-shell.module.css}\`
- \`src/app/(workspace)/dashboard/dashboard-client.tsx\` — pouze extrakce sdílené horní lišty v tomto úkolu; dřívější změny dashboardu zachovány.
- \`src/components/search/workspace-search.tsx\` — placeholder podle reference.
- \`src/app/(workspace)/invoices/{invoice-list-presentation.test.ts,invoice-payment-flow.test.ts}\`; upravené testy dashboard mocku, rolí, mobilu, prázdných stavů, prefetch a invalidace.
- \`src/lib/invoice-page-size.ts\`, \`invoice-list-query.ts\`, \`invoice-list-page-data.ts\`, \`invoice-pagination.test.tsx\` — uložená velikost stránky a serverové načítání.
- \`src/lib/invoice-list-{rpc-params,totals}.ts\`, \`src/lib/invoice-totals-key.ts\`, \`src/app/api/invoices/totals/route.ts\` a jejich testy — autorizovaný součet podle stejných filtrů jako seznam.
- \`eslint.config.mjs\`, \`vitest.config.mts\` — ignorování generované cache.
- \`scripts/invoices-{design-check,design-fixtures,visual-comparison}.mjs\` a tato složka validace.

Reprodukce: \`node scripts/invoices-design-check.mjs\`, potom \`node scripts/invoices-visual-comparison.mjs\`. Nevytvářet znovu \`before.png\` z upraveného UI.
`);
console.log(JSON.stringify({width,height,output:dir,comparison:'same-size, 50% overlay and absolute RGB difference'}));
