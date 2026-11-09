from pathlib import Path
import json,collections,html
root=Path.cwd();out=root/'artifacts/responsive-audit/2026-11-02';docs=root/'docs/responsive-audit'
def load(p):return json.loads((out/p).read_text())
rows=[]
for p in sorted((out/'production-source').glob('results*.json')):rows.extend(json.loads(p.read_text()))
by=collections.defaultdict(list)
for row in rows:by[row['route']].append(row)
text='''# Mapa pokrytí a otevřené podmínky

Datum: 2. 11. 2026. `measured` znamená, že byla vykreslena skutečná komponenta ve zdrojovém harnessu a zaznamenána geometrie. Není to schválení designu, plný produkční E2E test ani tvrzení, že všechny stavy prošly funkčními asercemi.

## Povinné chybějící reference

| ID | Co chybí | Důkaz | Dopad |
| --- | --- | --- | --- |
| B-01 | Skutečné běžné okno MacBooku: viewport, zoom, browser/OS a interní/externí displej | Uživatelský výstup 440×956/DPR3/UA iPhone identifikuje mobilní emulaci; desktopový výstup zatím nebyl dodán | Žádný odhadovaný rozměr se neuzamyká jako referenční desktop |
| B-02 | Přihlášená živá produkční reference dashboard/faktury/import | Autorizovaná existující testovací session skončila na `/login` pro všechny 3 chráněné stránky | Izolované snímky přesného commitu nejsou vydávány za přihlášenou produkci |
| B-03 | Fyzické Safari, softwarová klávesnice a nativní browser zoom | Desktopová emulace; při změně orientace ve WebKitu se prohlížeč zavřel | Orientace/klávesnice nejsou označeny jako fyzicky ověřené |

## Vykreslené obrazovky

Tabulka je generovaná z aktuálních výsledků. Některé šířky se opakují v různých stavech a prohlížečích. `/invoices/detail` je pouze URL alias harnessu pro skutečný dynamický klient faktury, nikoliv nová aplikační route.

| Obrazovka / alias | Prohlížeče | Změřené CSS šířky | Vykreslené varianty |
| --- | --- | --- | --- |
'''
for route,rs in sorted(by.items()):
 text+='| `'+route+'` | '+', '.join(sorted({r['engine']for r in rs}))+' | '+', '.join(str(w)for w in sorted({r['width']for r in rs}))+' | '+', '.join(sorted({r['scenario']for r in rs}))+' |\n'
text+='''
## Jak číst varianty

- `normal`: výchozí syntetická data skutečné UI komponenty.
- `empty`: vyprázdnění seznamů/dashboardu/reportů, chybějící historie nebo „missing“ předplatné podle kontraktu. Prázdná firma v settings není samostatně tímto názvem ověřena.
- `stress`: skutečně prodloužené identifikátory/názvy, velké částky a kontakty u dashboardu, faktur/detailu a zákazníků. Ostatní komponenty mají ve variantě část stejných údajů; název varianty sám neprokazuje zatížení každé komponenty.
- `viewer`: prezentace s viewer profilem a příslušnými datovými flags. Neověřuje serverové vynucení oprávnění ani oprávněnost přístupu na stránku.
- `error`: řízené HTTP 503 pro mapované endpointy. Pokud UI nerevaliduje initialData a žádný požadavek nevznikne, nejde o otestovanou chybovou obrazovku. Dashboard alert a deep OCR/payment chybové scénáře mají přímé důkazy; ostatní chyby musí být vázány na konkrétní další interakci.
- Matrix bez touch flagu měří úzký viewport se standardním pointerem. Samostatná touch matice aktivuje coarse-pointer pravidla. Žádná emulace netvrdí přítomnost skutečné softwarové klávesnice.

## Rozšířený audit vstupních stránek

[Login, registrace, MFA, obnova hesla, firemní vstup, pozvánky a všech osm kroků onboardingu](AUTH_ONBOARDING.md) mají samostatnou specifikaci, syntetickou galerii a doplňující kontrolní scénáře.

## Interakce s přímým důkazem

Viz `interactions/results.json`: otevření/zavření navigace, scroll lock, mobile row menu, native dialog úhrady, přístup ke kontaktům, malý notebookový table scroll, native validace a zachování rozepsané položky. Orientace Chromium je emulované ověření; WebKit je neúspěšný environment check. Root rem-only enlargement a skutečné zdvojení computed fontů jsou rozlišeny, nejsou vydávány za totéž.

`deep-workflows/ocr-review/validation.json`: 5 viewportů + 13 funkčních scénářů. `deep-workflows/ocr-processing/validation.json`: 8 scénářů reálné fronty/processing/recovery. `deep-workflows/payment-matching/validation.json`: 6 viewportů a další scénáře výběru, filtrů, chyby uložení, bankovní brány a dialogů. Jde o reálné komponenty s řízenými dokumentovými/API odpověďmi, nikoliv skutečné OCR, storage, účetnictví nebo rozesílání.

## Co zůstává omezené či statické

- Firemní login/registrace a pozvánky: doplněné skutečné klientské komponenty se syntetickým brandingem a pozvánkou, včetně prošlé pozvánky a jiného účtu. Skutečná serverová tenant/invitation URL a přijetí neověřeny; viz [samostatný audit](AUTH_ONBOARDING.md).
- Operátorská stránka: UI se syntetickými organizacemi; skutečné operator autorizační/data dotazy neověřeny.
- Onboarding: doplněno všech osm kroků a zachování draftu mezi kroky/šířkami. Skutečné vytvoření firmy, platební onboarding session a dokončení Stripe neověřeno.
- Auth/MFA/password reset: vykreslené klienty a syntetické stavy; neproběhlo skutečné odeslání kódu, přihlášení ani změna hesla.
- Next/font na auth/landing a serverové layouty nejsou v harnessu kompletně reprodukované. Veřejné živé stránky mají samostatné produkční snímky; chybějící chráněné stránky nikoliv.
- Základní matice není úplný kartézský součin všech datových/rolových stavů, šířek a prohlížečů. Print, fyzická klávesnice a další otevřená menu vyžadují doplnění dle komponentové specifikace.
- Pixelové regresní aserce proti schválenému desktopu jsou připravené, ale zatím blokované manifestem `not_approved`. Nejsou označeny jako úspěšně proběhlé.

## Klasifikace stavů dokončení

`verified-render` = reálné UI/zdroj + záznam; `verified-interaction` = konkrétní aserce; `source-only` = statické čtení; `environment-limited` = nástroj/prohlížeč nepokrývá prostředí; `not-captured` = chybí reference/přístup; `proposed` = návrh pro další implementaci. Tyto kategorie se neslučují do jediného zeleného „pass“.
'''
(docs/'COVERAGE.md').write_text(text)
readme='''# Responzivní audit Splatno — průvodce

## Čtení výstupů

1. `REPORT.md`: nálezy, důkazy, co fungovalo a meze závěrů.
2. `../../RESPONSIVE_DESIGN_SYSTEM.md`: návrh systému a kontrakty komponent.
3. `COVERAGE.md`: přesné pokrytí a chybějící reference.
4. `IMPLEMENTATION_SEQUENCE.md`: následné malé kroky; v této fázi nebyly provedeny.
5. `AUTH_ONBOARDING.md`: podrobná vstupní a onboarding rodina.
6. `../../artifacts/responsive-audit/2026-11-02/index.html`: lokální vizuální galerie porovnávající produkční zdroj a dosavadní pracovní změny.

## Opakování měření

Předpoklady: existující uzamčené závislosti projektu, Playwright prohlížeče a lokálně dostupný git objekt produkčního commitu. Nic se neinstaluje a nemění se aktuální aplikační pracovní strom. `prepare` připraví izolovaný archiv tracked zdrojů a pouze symlink na existující node_modules.

```sh
node scripts/responsive-audit/prepare.mjs
node scripts/responsive-audit/inventory.mjs
node scripts/responsive-audit/run.mjs --matrix
node scripts/responsive-audit/run.mjs --states --states-only
node scripts/responsive-audit/run.mjs --engine=webkit --states
node scripts/responsive-audit/run.mjs --engine=firefox --routes=/invoices,/invoices/create,/customers,/reports
node scripts/responsive-audit/run.mjs --local
node scripts/responsive-audit/interactions.mjs
node scripts/responsive-audit/deep-workflows.mjs
node scripts/responsive-audit/deep-workflows.mjs --processing-only
node scripts/responsive-audit/geometry.mjs
node scripts/responsive-audit/auth-onboarding.mjs
node scripts/responsive-audit/auth-onboarding.mjs --engine=webkit
python3 scripts/responsive-audit/build_auth_report.py
node scripts/responsive-audit/repeatability.mjs
```

Běhy používající tentýž port musí běžet sekvenčně. `--route=/customers` omezuje jednu route, `--routes=/dashboard,/invoices` množinu, `--smoke` tři kontrolní šířky, `--touch` coarse-pointer režimy. `--resume` zachová již změřené případy bez chybějících endpointů; při chybě renderování se runner zastaví. Nemíchat různý zdroj/data/režim do stejného schváleného baseline souboru.

Při opakování první široké matice se mohou přidat nově zahrnuté veřejné/MFA routy; počet staršího doloženého běhu je uložen ve výsledcích, nikoliv odvozován z aktuálního počtu rout v kódu.

## Živá produkce

`node scripts/responsive-audit/production.mjs` zachycuje produkci bez přenosu přihlášení. Volba `--authorized-test-session` je vyhrazená pro výslovně autorizované použití existujícího testovacího přihlášení na téže produkční aplikaci; nepoužívat ji bez odpovídajícího povolení.

V tomto auditu uživatel výslovně povolil tento konkrétní přenos po prvotním zamítnutí automatickou kontrolou. Cookies byly použity pouze v paměti a nebyly uloženy do výstupů. Všechny ne-GET/HEAD požadavky prohlížeče byly blokovány. Stávající session přesto skončila na loginu; audit nevytvářel nové přihlášení a nevyžadoval hesla/tokeny. GET navigace může mít běžné serverové vedlejší efekty, například logování; nejde o garanci absolutně nulových serverových zápisů.

Případné přihlášené screenshoty se ukládají výhradně do ignorované `.cache/responsive-audit/private-production`, nikoliv do sdíleného balíčku. Auth storage, cookies, hesla a HAR/trace s credentials nejsou výstupem auditu.

## Reference MacBooku

Z běžného produkčního okna bez mobilní emulace zjistit `innerWidth`, `innerHeight`, `visualViewport`, DPR a userAgent; dodat také skutečný zoom a displej. Konzole v samostatném okně nesmí měnit pracovní šířku aplikace. Viewport 440×956/iPhone není desktopová reference.

Dodaný rozměr se eviduje nejprve jako `reported`; teprve po zachycení stejného produkčního vzhledu a prostředí lze uzamknout designovou referenci. `1440×900` zůstává diagnostický viewport, dokud skutečné měření neprokáže shodu.

## Schválené screenshotové testy

```sh
corepack pnpm exec playwright test --config scripts/responsive-audit/playwright.config.mjs --list
corepack pnpm exec playwright test --config scripts/responsive-audit/playwright.config.mjs
```

První příkaz pouze ověřuje seznam 12 testů. Druhý má nyní záměrně skončit blokací chybějící schválené reference. Nenastavovat `--update-snapshots`, neobcházet manifest a nevydávat tuto blokaci za pass. `toHaveScreenshot` je připraveno pro explicitně schválené kandidáty ve stejném prostředí; nejde o nyní proběhlé schválení designu.

## Rozhraní a omezení harnessu

- `fixtures.mjs`: kontrolovaná data; žádné produkční hodnoty, služby ani přihlašovací údaje.
- `harness.mjs` + `entry.template.txt`: skutečné komponenty z určeného zdroje; adaptéry Next a syntetické API. Externí browser požadavky jsou v izolovaných bězích blokované.
- Měření obsahuje route, source label, engine, viewport, scenario, pointer režim, render status, geometrii, HTTP výsledky a cestu screenshotu. `measured` není schválení.
- Datum je fixováno pomocí `page.clock.setFixedTime`, běžné časovače běží. Hlubší převzaté OCR/payment kontroly mají vlastní řízené podklady; nejsou všechny pokryty stejným časovým bootstrapem.
- Deep-workflow adaptéry vznikají v cache z existujících testů produkční revize. Výstupy obsahují validační JSON a log. OCR je v těchto testech lokální/syntetické; prostředí neprokazuje skutečného produkčního providera.
- Vite nepředstavuje celý Next.js SSR/production CSS chunking. To je výslovná mez důkazu a důvod nepovyšovat automaticky kandidáty na produkční baseline.

Produktové soubory, existující pracovní změny, databáze a deployment nebyly měněny. Nové soubory tvoří jen dokumentace, auditní/testovací skripty a artefakty.
'''
(docs/'README.md').write_text(readme)
sequence='''# Následná implementace — pořadí malých změn

Tento dokument je plán dalších změn, nikoliv seznam úprav provedených auditem. Každý krok má vlastní diff, důkazy a možnost vrácení. Nepřepisovat současný pracovní strom; nejprve oddělit existující lokální změny od produkčního základu.

| Krok | Obsah | Povinný důkaz dokončení |
| --- | --- | --- |
| 0. Reference | Změřit skutečné okno MacBooku, zachytit přihlášenou produkci a přiřadit přesný commit | B-01/B-02 vyřešeny; žádný náhradní odhad/login screenshot |
| 1. Baseline | Schválit odpovídající syntetické kandidáty a geometrii; doplnit stavy/font/SSR rozdíly | Pixelový a funkční guard funguje bez automatického updatu snímků |
| 2. Kontakt zákazníka | Jedna lokální oprava R-001: dostupný kontakt/editace v kompaktní variantě | Admin má dosažitelný kontakt v 390/768/1024/1280/reference; viewer nemá editaci; uložení/chyba zachová draft |
| 3. Invoice řádek | Kompaktní varianta podle vlastního kontejneru pod 1090 px | 1024×768 bez nutnosti horizontálního posunu k akcím, data/selection/sort/paging zachovány; Standard beze změny |
| 4. Částky | Přezkoumat již existující lokální R-003 opravu místo druhého řešení | Žádný zbytečný scroll span; přesná hodnota i tooltip po resize/font load; sdílené ostatní částky bez regrese |
| 5. Shell kontrakt | Vyřešit pouze doložené konflikty viewport/JS nav; nezačínat přepisem celé navigace | Drawer/scroll lock/focus, 600px výška, změna šířky s rozepsanou fakturou, sidebar 244 px |
| 6. Rolové aliasy | Jedna rodina komponent za krok; nejprve aliasovat stávající hodnoty | Chráněný Standard/mobil beze změny; explicitní diff každé záměrné změny |
| 7. Skupiny a Wide | KPI/grafy/upload/editor zvlášť; role Expanded mají omezené maximum | Multi-currency/long-content/short-window; nepřevzít lokální zoom jako nový globální standard |
| 8. Interakce a úklid | Popup/keyboard/print a odstranění prokazatelně nahrazených pravidel | Staging/Next a fyzické Safari, keyboard, print; odstranění má konkrétní náhradu a žádný nový globální workaround |

Každý krok rozliší: opravu potvrzené chyby, změnu mimo chráněnou referenci a návrh viditelné změny referenčního desktopu. Třetí typ se nesmí schovat do technického refaktoru.

## Obecná akceptace

- Schválená reference bez nechtěné změny; screenshoty nepřepisovat jen proto, že test selhal.
- Důležité informace/akce nezmizí při změně kontejneru a nedochází k horizontálnímu přetékání dokumentu.
- Funkce se ověřují skutečnou interakcí. HTTP mock bez zobrazeného stavu není důkaz chybového UI.
- Drafty, výběry, přesné peněžní hodnoty, role, auth/MFA/cookies, routování, backend a exporty zůstávají zachované.
- Kontroly zahrnou opravenou šířku, její sousední hranice a nedotčené mobilní/Standard režimy.
- Změny se nejprve ověří izolovaně a v reálném Next/staging prostředí; deploy není součástí této auditní fáze.
'''
(docs/'IMPLEMENTATION_SEQUENCE.md').write_text(sequence)
# Browser-rendered evidence comparison: only synthetic images.
pairs=[]
local=load('local/results-chromium.json');prod=load('production-source/results-chromium-matrix.json')
for a in local:
 if not a.get('screenshot'):continue
 b=next((x for x in prod if x['route']==a['route']and x['width']==a['width']and x['height']==a['height']and x.get('screenshot')),None)
 if b:pairs.append({'route':a['route'],'width':a['width'],'height':a['height'],'production':'production-source/'+b['screenshot'],'local':'local/'+a['screenshot'],'productionZoom':b['metrics']['mainZoom'],'localZoom':a['metrics']['mainZoom']})
page='''<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Splatno — auditní porovnání</title><style>body{margin:0;padding:24px;background:#f5f8f5;color:#183529;font:16px/1.5 system-ui}main{max-width:1800px;margin:auto}header{margin-bottom:24px}select{font:inherit;padding:8px;max-width:100%}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}article{min-width:0;background:white;border:1px solid #d9e4dc;border-radius:12px;padding:16px}img{width:100%;height:auto;display:block}small{display:block;color:#52695b}a{color:#17613f}@media(max-width:800px){.grid{grid-template-columns:1fr}body{padding:12px}}</style><main><header><h1>Audit: produkční zdroj × lokální změny</h1><p>Skutečné komponenty se syntetickými daty. Toto nejsou přihlášené produkční screenshoty ani schválená MacBook baseline.</p><label>Obrazovka a diagnostický viewport <select id="pick"></select></label></header><div class="grid"><article><h2>Produkční revize 26defdc</h2><small id="pm"></small><a id="pa"><img id="pi" alt="Produkční zdroj se syntetickými daty"></a></article><article><h2>Aktuální lokální úpravy</h2><small id="lm"></small><a id="la"><img id="li" alt="Lokální pracovní verze se syntetickými daty"></a></article></div></main><script>const pairs=__PAIRS__;const pick=document.querySelector('#pick');for(const[pairIndex,pair]of pairs.entries()){const o=document.createElement('option');o.value=pairIndex;o.textContent=pair.route+' — '+pair.width+' × '+pair.height;pick.append(o)}function show(){const p=pairs[Number(pick.value)];for(const[s,prefix]of[['production','p'],['local','l']]){document.querySelector('#'+prefix+'i').src=p[s];document.querySelector('#'+prefix+'a').href=p[s];document.querySelector('#'+prefix+'m').textContent='CSS zoom hlavního obsahu: '+p[s+'Zoom']}}pick.onchange=show;if(pairs.length)show();</script></html>'''.replace('__PAIRS__',json.dumps(pairs,ensure_ascii=False))
(out/'index.html').write_text(page)
(out/'gallery-pairs.json').write_text(json.dumps(pairs,ensure_ascii=False,indent=2)+'\n')
print('Coverage routes',len(by),'gallery pairs',len(pairs))
