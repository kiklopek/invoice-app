# Splatno — specifikace responzivního systému

**Verze:** auditní návrh 1.0 · **Datum:** 2. 11. 2026 · **Produkční zdroj:** `26defdcc90f9ebaf979d40d23a6c5c7648dd0e0f`.

**Stav:** pravidla a migrační postup jsou navrženy na základě měření skutečných komponent. Referenční MacBook desktop zatím není uzamčen: dodaný viewport identifikuje iPhone a chráněná živá produkce se stávající session není dostupná. Hodnoty z diagnostického 1440×900 nelze vydávat za schválenou MacBook baseline. Tento dokument nic nemění v aplikaci.

**Následná implementace:** po výslovném schválení uživatelem byla lokálně provedena [responzivita loginu, registrace a onboardingu](docs/verification/auth-entry-responsive.md). Tato samostatná změna upravuje dva CSS soubory; ostatní části níže zůstávají návrhem. Auditní stav a chybějící MacBook reference výše popisují původní auditní fázi.

**Společný workspace vzor:** navazující [implementace společného měřítka, navigace a rodin pracovních pláten](docs/verification/workspace-responsive-pattern.md) odstraňuje původní seznam rout pro škálování. Toto je aktuální pravidlo pro workspace; historický audit výše popisuje předchozí stav.

## 1. Závazné rozhodnutí a rozsah

- Zachovat vzhled a ovládání mobilu; povolit pouze doložené drobné úpravy rozměrů, mezer a uspořádání.
- Tablet navrhovat hybridně: dotyková navigace, ale rozložení komponent podle skutečně dostupné šířky.
- Produkční vzhled v běžném okně na MacBooku Air je ochranná reference. Lokální experimenty nejsou automaticky schválený design.
- Aktualizované zadání uživatele: desktopový sidebar, texty, ikony, profil a horní ovládání mají růst koordinovaně s pracovním obsahem, s omezeným měřítkem. Navigace má výraznější vlastní růst, který současně zvětšuje její šířku i vnitřní prvky. Dřívější požadavek na pevnou navigaci je tímto nahrazen.
- Držet proporce v rámci rodiny komponent. Nesjednocovat výšku tabulky, editoru a KPI jedním pravidlem.
- Neprovádět univerzální zmenšování celé aplikace. Vybrané plynulé rozměry doplnit explicitními režimy Compact/Standard/Expanded.
- Autentizace, MFA, role, cookies, backend, API, finanční výpočty a exportované částky nejsou součástí redesignu. Mění se teprve později prezentace, po ověření referencí.

## 2. Vlastnictví pravidel

| Vrstva         | Vlastní                                                               | Nevlastní                                        | Spouštěč                                |
| -------------- | --------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------- |
| Shell          | Navigaci, offset hlavního obsahu, topbar a vnější odsazení            | Vnitřní hustotu jednotlivých tabulek a formulářů | Viewport a konzistentní JS media query  |
| Rodina stránek | Šířku plátna, vztah hlavičky/filtrů/pracovního panelu a přirozený tok | Konkrétní velikost částek či řádkového menu      | Dostupnou šířku a výšku                 |
| Skupina        | Počet sloupců, vzájemné zarovnání a výšky souvisejících karet         | Globální velikosti navigace                      | Inline-size kontejneru                  |
| Komponenta     | Zalomení, informace, akce a lokální variantu                          | Rozhodnutí, zda je zařízení „tablet“             | Obsah a vlastní kontejner               |
| Interakce      | Dialog/top layer, popup bounds, focus a scroll lock                   | Globální layout                                  | Otevřený stav, viewport, visualViewport |

Každá budoucí oprava určí vlastníka. Další globální override se nepřidává, pokud lze opravu omezit na existujícího vlastníka. Staré deklarace se odstraňují pouze s důkazem, že je konkrétní změna nahrazuje.

### Prostředí pro organizaci a ověření

| Pásmo CSS viewportu | Výchozí charakter  | Omezení                                                                                        |
| ------------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| 320–639             | Současné Mobile UI | Zachovat identitu, tok a důležité akce                                                         |
| 640–1023            | Hybridní UI        | Zachovat existující navigační kontrakt pod 1024; karty/tabulky se rozhodují samostatně         |
| 1024–1279           | Compact Desktop    | Sidebar má standardní velikost; obsah nesmí ztrácet funkce kvůli úzkému zbytku                 |
| 1280–1919           | Standard Desktop   | Zachovat produkční proporce; skutečná MacBook reference má přednost před názvem pásma          |
| 1920–2559           | Expanded-capable   | Více prostoru/obsahu, omezené zvětšení pouze vhodných rolí                                     |
| 2560+               | Wide               | Omezená šířka čitelného obsahu, doplňující sloupce tam, kde dávají smysl; žádný nekonečný růst |

Pásma nejsou sada povinných společných media queries. Například fakturační řádek může změnit variantu při šířce svého kontejneru 1090 px bez změny navigace. Podporované minimum je 320 CSS px. Menší šířky nesmí skrývat zavření dialogu, ale nejsou samostatně navržený režim.

## 3. Naměřená produkční stupnice a návrh tokenů

Níže jsou měření při diagnostickém 1440×900 se syntetickými daty a staticky ověřené role. Nejde o naměřené okno uživatele. Rozměry se nesmí globálně aplikovat přepsáním všech input/button elementů.

| Role                  | Naměřená/ověřená Standard hodnota                                  | Compact návrh                                                                  | Expanded návrh                                            |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Sidebar               | Šířka 244 px; navigační text 14 px; ikony přibližně 20 px          | Stejné rozměry; pouze již existující úpravy pro nízké okno                     | Beze zvětšení                                             |
| Vyhledávání v topbaru | Výška 42 px; text 12 px                                            | Zachovat desktopovou velikost; mobil používá vlastní ovladač                   | Zachovat; šířku lze využít podle role                     |
| Primární topbar akce  | Min. výška 44 px; text 13 px; ikona 19 px                          | Stejný target, méně horizontálního místa a přeskupení                          | Max. 48 px / text 14 px / ikona 20 px                     |
| Filtry faktur         | Select 42 px / 13 px; datumové pole 40 px / 12 px                  | Přeskupit pole; nezmenšovat text pod stávající minimum                         | Rozměry ponechat, využít prostor pro přehlednější skupiny |
| Tvorba faktury        | Pole 44 px / 14 px                                                 | Stejná pole; změnit počet sloupců                                              | Nejvýše 48 px / 15 px, až po odlišném schválení této role |
| Auth                  | Pole 52 px / 16 px; primární akce 56 px; desktopový titul do 46 px | Zachovat vlastní existující mobilní pravidla                                   | Auth se globálním Expanded režimem nezvětšuje             |
| Dashboard titul       | 32 px                                                              | Stávající mobilní/kompaktní formula, žádné plošné sjednocení s titulkem faktur | Nejvýše 36 px                                             |
| Přehled faktur titul  | 42 px                                                              | Stávající kompaktní varianta                                                   | Nejvýše 46 px                                             |
| Editor titulek        | Do 40 px                                                           | Stávající nižší varianta podle kontejneru                                      | Nejvýše 44 px                                             |
| KPI hlavní hodnota    | Typicky 36 px v Standard roli                                      | Zachovat existující mobilní hodnoty a adaptivní částky                         | Nejvýše 40 px                                             |
| Metadata              | Obvykle 12–13 px                                                   | Nezmenšovat jen proto, aby se vešla tabulka                                    | Obvykle zachovat, nikoliv automaticky násobit zoomem      |

**Ochrana Standard:** dokud není zachycen skutečný MacBook, tyto aliasy pouze popisují role. Nezavádí se zaokrouhlení současné fluidní hodnoty např. 31.68 na 32 px. Stávající výpočet nebo výjimka zůstane zachovaný, pokud by normalizace měnila referenční vzhled.

### Mezery a skupiny

Základní pojmenovaná řada pro nové lokální kontrakty: 4 / 8 / 12 / 16 / 20 / 24 / 32 px. Existující 14px mezery KPI a jiné schválené výjimky se zachovávají jako pojmenované aliasy; neprovádí se plošné „zaokrouhlení“ layoutu.

- Compact zmenšuje především vnější mezery a počet sloupců; nezmenšuje finanční text nebo dotykové akce do nečitelné velikosti.
- Standard zachovává konkrétní produkční hodnotu dané role, nikoliv jedinou globální hodnotu pro všechny karty.
- Expanded může zvětšit rolové mezery nejvýše o jeden krok stupnice a ovládání podle tabulky. Nespouští se automaticky na všech komponentách.
- Dotykové akce mají dostupnou plochu alespoň 44×44 CSS px. Velikost glyphu může zůstat menší. Existující coarse-pointer pravidla se nejprve zachovají a ověří.
- Přesná finanční hodnota zůstává datově nezměněná. Formát se může zkrátit pro prostor, celá hodnota musí být dostupná focus/tap/tooltipem a v exportu.

## 4. Kompozice podle rodiny stránek

### Přehledy a tabulky

Hlavička a filtry zůstávají u horní části obsahu. Tabulka přirozeně roste podle řádků. Svisle ji necentrovat. Pokud je schválena minimální výška panelu s pagination dole, vyplňovat pouze volný prostor panelu, nikoliv natahovat výšky jednotlivých řádků.

### Dashboard a přehledové karty

Výšky vyrovnávat v rámci jednoho řádku KPI, nikoliv mezi KPI a dlouhým seznamem. Trend a stavový graf mohou tvořit skupinu s vyrovnaným rámem, ale vnitřní plot/legenda mají vlastní pravidla. Dlouhé tabulkové registry nesmějí určovat výšku všech sousedních karet.

### Upload a statické úvodní pracovní plochy

Hlavička, přepínače a upload patří k jedné vizuální rodině a zachovávají čitelný odstup u divideru. Výchozí Standard rozmístění zůstává podle produkce; nepřebírá se automaticky lokální experiment s centrováním spodního bloku. Velké volné plochy se vyhodnocují v kontextu celé skupiny. Univerzální centrování všech stránek není součástí návrhu.

Maximální šířka dokumentového importu 1480 vnitřních CSS px je existující základ, který se má zachovat do schválení jiné kompozice. Širší monitor zvětšuje vnější prostor, nikoliv automaticky každou vnitřní ikonu. Přechod do zpracování/review je nová pracovní varianta s přirozenou výškou a jinými pravidly.

### Editory a review

Formulář má přirozenou výšku. Dokumentový náhled může být sticky a omezený dostupnou výškou; u menšího prostoru přepnout existující taby údaje/dokument. Nezavádět dva nezávislé nucené scrollbary jen kvůli stejným výškám sloupců. Přepnutí musí zachovat data, vybraný dokument a jeho polohu, kde už to komponenta podporuje.

### Auth a onboarding

Samostatná podrobná specifikace: [login, registrace, MFA, obnova hesla, pozvánky a všech osm kroků onboardingu](docs/responsive-audit/AUTH_ONBOARDING.md). Obsahuje vlastní velikostní role, centrování, scrollování, tabulku pracovních stavů a důkazy; tato rodina není redukována na jediný obecný řádek.

Vlastní rodina rozměrů; na menších šířkách bez dekorativní ilustrace podle současných pravidel. Nezahrnovat do univerzálního zoomu workspace. Dlouhá registrace/onboarding přirozeně scrolluje, akce a validace musí zůstat dosažitelné i po otevření klávesnice. Klávesnice vyžaduje další fyzické ověření.

## 5. Kontrakty hlavních komponent

`W` znamená vnitřní dostupnou šířku konkrétního kontejneru, ne šířku celé obrazovky. Navržené hodnoty níže jsou implementační doporučení po auditu; žádná z nich zatím není zavedena do produktového kódu.

| Komponenta/skupina     | Standard a minimální prostor                                                                | Compact/Mobile chování                                                                                    | Výška, dlouhý obsah a povinné akce                                                | Akceptace                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Shell/navigace         | Existující desktop od 1024 viewportu; 244px sidebar                                         | Stávající horní/drawer navigace pod 1024; zachovat <=767 mobilní vrstvu                                   | Účet a odhlášení dostupné v 600px výšce; drawer obnoví scroll a focus             | Otevření/zavření, Escape, resize, role a zachování formuláře               |
| Topbar                 | Zachovat Standard akce a search                                                             | Search/notifications přes existující mobilní sloty, ne dvě současně aktivní kopie                         | Klávesnicí dosažitelné akce, čitelné labels; žádné oříznutí zavření               | 320, 640, 768, 1024, skutečná reference                                    |
| KPI skupina            | Čtyři karty pouze když každá splní svoji existující minimální šířku; Standard 1440 má čtyři | Zachovat současné dobře fungující mobilní 2×2; při zvětšení textu dovolit další rozpad, ne násilné nowrap | Vyrovnání stejné skupiny; měny přirozeně rostou; celé hodnoty dostupné            | Multi-currency, nulové/záporné/velké hodnoty, 200% text                    |
| Dashboard grafy        | Společná skupina při W>=1000; vlastní container queries legendy                             | Pod 1000 řadit celé karty; uvnitř zachovat existující lokální prahy                                       | Plot a legenda nesmí ztratit názvy; dostupná datová alternativa                   | 1 období, 12+ období, prázdná data, legenda, menu                          |
| Invoice list           | Plná tabulka od W>=1090: vychází z naměřeného min-width                                     | 640–1089: dvouúrovňový kompaktní řádek; W<640: zachovat stávající mobilní karty                           | Výběr, identita, částka, stav a menu dostupné bez horizontálního posunu celé řady | 1024×768; zachovat všechny akce; desktop reference beze změny              |
| Invoice filtry         | Role seskupené podle obsahu, nikoliv násobení šířek datových polí                           | Přeskládat řádky a použít existující mobilní disclosure                                                   | Datum a validace musí zůstat editovatelné; aktivní filtry a reset viditelné       | Hraniční šířky, otevření, reset a načtení chyby                            |
| Customer list          | Plný přehled od W>=960, pokud všechny role splní prostor                                    | 640–959: kompaktní přehled s dostupným rozbalením kontaktu; pod 640 současné karty                        | E-mail/telefon/editace nesmí zmizet bez náhrady. Nezavádět novou datovou logiku   | 390/768/1024/1280: admin kontakt i editace dosažitelné; viewer bez editace |
| MoneyAmount            | Existující měření variant a přesná aria/title hodnota                                       | Compact formát podle skutečné šířky, ne scrollbar pro několik pixelů                                      | Fonty/probes sdílejí skutečný font; žádný scroll skrytých měřicích alternativ     | Long/negative/zero částky, tooltip focus/tap, resize a font load           |
| Ruční faktura          | Stávající skupiny polí; celé datumové pole musí splnit šířku                                | Existující mobilní kroky, místní rozpad skupin a plná šířka dat                                           | Validace u pole, žádný překryv akce, zachované hodnoty                            | Native validace, přechod šířek, 320px datum a variabilní symbol            |
| Tvorba faktury/položky | Současný Standard dokument a položkový kontejner                                            | Zachovat existující paper/items container queries a mobilní editor                                        | První, více a dlouhé položky přirozeně rostou; ceny přesné                        | 320/390/767/768/1024/reference, neplátce a dlouhé popisy                   |
| Detail faktury         | Souhrn, dokument, historie a akce jsou samostatné skupiny                                   | Existující mobilní sekce; akce nezmizí za náhledem                                                        | Historie přirozená; lokální sticky pouze kde je prostor                           | Paid/partial/overdue, prázdná historie, dokument error, viewer             |
| Document/CSV start     | Existující Standard šířka a hlavička                                                        | Dostupná dropzone, souborový input a přepnutí režimu                                                      | Nesmí zaměnit start a aktivní review; dlouhý název souboru nezvětší viewport      | Souborové chyby, režimy, 320/640/1024, nízké okno                          |
| OCR fronta/zpracování  | Reálné fáze a údaje dávky; zachovat současnou prezentaci                                    | Rozpad pouze prezentace, ne timer-driven fake progress                                                    | Stop dokončí právě běžící dokument a zachová ostatní                              | 8 processing scénářů, chyby a návrat do review                             |
| OCR review             | Existující společný header/picker/form/document                                             | Existující taby podle dostupnosti; formulář a originál sdílí výběr                                        | Zachovat draft, stránku/zoom dokumentu, warnings a akce                           | 13 deep-review scénářů + vybraný dokument/poloha po přepnutí               |
| Statement matching     | Současné registry a inline picker reagují na dostupnou šířku                                | Detail/filtry a přiřazení zůstávají dosažitelné v 320 px                                                  | Výběr, dílčí alokace, důvod shody a chyby zachovají rozhodnutí                    | 6 viewportů, bank gate, chyby uložení, bulk a reset filtrů                 |
| Reminders/editor       | Politika, automatizace a e-mail preview jsou různé skupiny                                  | Přeskládat skupiny podle jejich kontejneru; nezmenšovat společně všechny kontrolky                        | Dlouhá pravidla a text přirozeně rostou; žádné skryté zapnutí automatizace        | Prázdná/vyplněná politika, role, dlouhý template, chyby uložení            |
| Reports                | Filtry, KPI, grafy a registry mají vlastní režim; print zvlášť                              | Existující mobilní controls; registry mohou mít výslovně označený lokální scroll                          | Význam dat a legenda se neztratí; tisk nepřebírá zoom obrazovky                   | Empty/multi-currency/long period, export dialog, print smoke               |
| Settings/subscription  | Formuláře, členové, účty a plán/historie nezávisle                                          | Hybridní sloupce podle obsahu, existující mobilní tabs/disclosure                                         | Tlačítka změn zachovají svá oprávnění; billing beze změn                          | Viewer/admin, historie/bez historie, formulářové chyby                     |
| Dialog/popover         | Existující native dialog/PopupFitter a umístění portálů                                     | Vejít se mezi bezpečné okraje, akce přístupné ve scrollovatelném obsahu                                   | Dialog nesmí ztratit zavření; menu změní stranu/pozici, ne ořízne akci            | 390px řádkové menu a úhrada, Escape/focus/scroll; klávesnice dodatečně     |
| Auth/MFA/onboarding    | Zachovat vlastní role, font a stávající autentizační operace                                | Form-only/mobilní kroky podle současných pravidel                                                         | Reálné operation/error stavy, bez falešného postupu                               | UI fixture + pozdější autentizované Next/staging ověření                   |

## 6. Ochrana proti regresím

### Tři odlišné úrovně reference

1. **Produkční designová reference:** skutečné přihlášené prostředí při přesném uživatelském viewportu. Zatím chybí.
2. **Kandidáti:** současné auditní screenshoty produkčních komponent se syntetickými daty. Nejsou automaticky schválené.
3. **Schválená regresní baseline:** explicitně evidovaný zdrojový commit, prostředí, viewport, data a snímky odpovídající designové referenci. Stav manifestu zatím `not_approved`.

Baseline runner je připraven v `scripts/responsive-audit/playwright.config.mjs`. Má `updateSnapshots: none` a chybějící schválení skončí jako blokace, ne jako zelené přeskočení. Nikdy nepropaguje aktuální snímek automaticky do schváleného stavu.

Po schválení: samostatné snímky pro Chromium/WebKit a platformu, pevný čas, CS locale, Europe/Prague, syntetická data, font readiness a stabilní síťový stav. Počáteční full-page tolerance je 0.1 % pixelů při barevném threshold 0.2, doplněná kontrolou geometrie a přístupnosti kritických akcí. Tolerance není povolení měnit layout; každý odlišný obraz mimo doložený renderovací šum musí být vyhodnocen.

### Povinná akceptace následného kroku

- Stejná schválená Standard reference nevykáže nechtěnou změnu.
- Důležité ovládání nezmizí ani při 200% textu; co nejde vložit vedle sebe, přejde do dalšího řádku nebo dostupného detailu.
- Žádný horizontální dokumentový overflow. Výjimky jako datový registry/document canvas mají zdokumentovaný lokální scroll a dosažitelné akce.
- Data, draft, výběr a oprávnění zůstanou zachované při přepnutí varianty.
- Funkční nálezy R-001/R-002/R-003 mají vlastní ověřovací scénáře, které po opravě ověřují očekávané zlepšení, nikoliv pouze shodu se starým obrázkem.
- Portrait guard, Next auth/SSR a fyzická virtuální klávesnice se nezamění za úspěch desktopové emulace.
- Print a exporty nezdědí obrazovkové škálování ani zkrácené finanční hodnoty.

## 7. Migrations a rozhraní

Žádná databázová migrace ani změna veřejného API/type contractu není potřebná. Budoucí CSS tokeny budou lokálně aliasovat stávající naměřené role. Případná varianta komponenty se přidá pouze k jejímu prezentančnímu rozhraní; datové zdroje a výpočty se nezduplikují.

Při zavádění komponentového kontejneru nejprve ověřit jeho vliv na grid sizing, sticky/fixed potomky a popupy. Není přípustné plošně zapnout containment na všechny karty. U původních globálních override musí být uvedeno, která nová lokální deklarace je nahrazuje.

Nejprve oddělit lokální změny od produkční baseline. Existující lokální odstranění scrollování částek a natažení invoice panelu jsou samostatné změny k přezkoumání; tento audit je ani nezrušil, ani neschválil k deployi.

## 8. Implementační pořadí a blokace

1. Dodat skutečný MacBook viewport/zoom/displej a zachytit přihlášenou produkční referenci.
2. Schválit odpovídající syntetické baseline a malé referenční regiony. Neaktualizovat snímky nad neodsouhlasenými lokálními styly.
3. Samostatný krok R-001: zachovat kontakt/editaci v kompaktním přehledu zákazníků.
4. Samostatný krok R-002: komponentový invoice řádek pod skutečnou šířkou 1090 px.
5. Přezkoumat již existující lokální řešení R-003 bez dvojí implementace; ověřit sdílené částky.
6. Teprve potom postupně zavádět rolové tokeny a pravidla skupin. Standard/mobil chránit při každém kroku.
7. Vyhodnotit Expanded režim jednotlivých rodin a následně odstraňovat pouze nahrazené globální deklarace.

**B-01:** skutečný desktopový viewport/zoom/displej chybí. **B-02:** chráněná živá produkční reference chybí, protože existující testovací session není platná pro tyto stránky. **B-03:** fyzické Safari/klávesnice a orientace vyžadují další ověření; WebKit emulace při orientaci spadla.

Tyto blokace nebrání čtení a použití auditních důkazů. Brání označení celého prvního kroku za schválenou produkční baseline nebo bezpečnému plošnému redesignu.

## Zdroje

- Aktuální produkční zdroj, statický inventář a vykreslená měření v `artifacts/responsive-audit/2026-11-02/`.
- [CSS container queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries).
- [Playwright: visual comparisons](https://playwright.dev/docs/test-snapshots).
- [Playwright: Clock](https://playwright.dev/docs/clock).
- Lokálně instalovaný Next.js CSS guide: pořadí importů a odlišnosti produkčního chunkování jsou důvodem, proč samotný Vite harness nelze vydávat za plný produkční Next build.
