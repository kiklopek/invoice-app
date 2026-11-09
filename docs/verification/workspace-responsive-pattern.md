# Společný responzivní vzor workspace

2. 11. 2026. Lokální implementace po navazujícím zadání: zjistit opakující se příčinu velkých mezer a opravit společné chování. Uživatel následně výslovně změnil původní požadavek na pevnou navigaci: nově mají společně růst i sidebar, profil, horní tlačítka, ikony a text.

## Nalezený vzor a příčiny rozdílů

| Vrstva            | Původní příčina                                                                       | Společné řešení                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Aplikační rám     | `data-proportional-layout` se nastavovalo jen pro import, platby a reporty            | Každý workspace používající `AppShell` má stejné výchozí omezené škálování; žádný seznam povolených rout pro škálování            |
| Navigace a profil | Při zvětšování obsahu zůstával sidebar 244 px a jeho obsah malý                       | Sidebar má vlastní výraznější omezený růst; jeho šířka, obsah a odsazení stránky se počítají ze stejné hodnoty                    |
| Výška             | `100dvh` uvnitř zvětšeného prvku znovu násobilo fyzickou výšku                        | Škálovaný `main` vlastní logický viewport `--workspace-height` / `--workspace-vh`; neškálované portály používají fyzický viewport |
| Vnitřní šířka     | Rodič i jeho formulář měly nezávislé pevné maximální šířky                            | Šířku řídí pracovní plátno; jeho formulář vyplňuje tento prostor. Konkrétně odstraněn druhý limit uvnitř ručního zadání           |
| Tabulky           | Panel vyplňoval viewport, stránkování bylo dole, ale řádky zůstaly nahoře             | Kolekce má přirozenou výšku a omezenou hustotu řádků; prázdný panel ani enormně vysoké řádky nenahrazují chybějící data           |
| Upload            | Hlavička byla pevně nahoře a upload nezávisle centrovaný v dalším vysokém bloku       | Rodina `task` seskupuje hlavičku a pracovní část do jednoho plátna; min. prostor uploadu, texty a mezery používají stejné tokeny  |
| Obsah karty       | Široká karta obsahovala malý pevný donut a legendu přitlačenou k druhému okraji       | Graf, legenda a detailní texty mají vlastní omezené velikosti podle kontejneru / společné stupnice                                |
| Dialogy           | Starý globální limit `100vh - 40px` se uvnitř škálovaného main zvětšil nad výšku okna | Společný limit pro nativní dialogy v main používá logický viewport. Ověřeno i v okně vysokém 600 px                               |

## Kontrakt pro stránky a nové komponenty

`AppShell` poskytuje stejný růst všem stránkám. `AppFrame.layout` popisuje kompozici, nikoliv povolení škálování. Výchozí `content` tedy také roste. Typy `overview`, `collection`, `form`, `task`, `document` vyjadřují vlastní pravidla práce s prostorem; nevytvářejí nové datové zdroje, routy nebo oprávnění.

```tsx
<AppFrame layout="collection">
  <section data-workspace-surface="records">{/* filtry / tabulka / stránkování */}</section>
</AppFrame>

<AppFrame layout={reviewActive ? "document" : "task"}>
  <div data-workspace-stage>{/* hlavička a pracovní panel */}</div>
</AppFrame>
```

Formulářové plátno používá `--workspace-canvas-max`; task používá `--workspace-upload-min`. Pro detailní text, finanční řádky a upload existují společné tokeny `--workspace-detail-text`, `--workspace-record-text`, `--workspace-task-title`, `--workspace-task-body`, `--workspace-task-meta`. Jejich vlastníkem je [workspace-shell.module.css](../../src/components/layout/workspace-shell.module.css), nikoliv jednotlivé routy.

Komponenta závislá na dostupné šířce nadále používá svůj kontejner, například donut v kartě dashboardu. Taková výjimka řeší obsah konkrétní karty. Nepřepisuje velikost celé navigace nebo cizích formulářů.

Uvnitř škálovaného main použít pro výškový limit `var(--workspace-height, 100dvh)`. Rozměry fyzických portálů mimo main se tím nemají násobit ani dělit. V tomto kroku byly sjednoceny související viewportové limity review, detailu faktury, editoru, vyhledávání a exportu. Tiskové zobrazení neaktivuje obrazovkové škálování.

## Rozměry a hranice

| Viewport    | Měřítko obsahu / navigace | Šířka navigace |
| ----------- | ------------------------- | -------------- |
| 1440 × 900  | 1× / 1×                   | 244 px         |
| 1920 × 600  | 1.114× / 1.214×           | 296 px         |
| 2560 × 900  | 1.218× / 1.409×           | 344 px         |
| 2560 × 1817 | 1.218× / 1.791×           | 437 px         |
| 3840 × 2160 | 1.295× / 1.85×            | 451 px         |

Navigace nově využívá i dostupnou výšku. Pro `g = max(0, (šířka − 1600) / 800)`, `w = g / (1 + g)` a `h = clamp(0, (výška − 1000) / 800, 1)` používá měřítko `min(1.85, 1 + 0.75w + 0.7hw)`. Hlavní obsah si ponechává původní měřítko `1 + 0.4w`. Šířka sidebaru i odsazení obsahu se počítají ze stejného výsledného měřítka navigace.

Přebytečnou výšku využívají také řádky a mezery hlavního menu: výška řádku `clamp(46px, 46px + 24px × hw, 64px)`, mezera `clamp(2px, 2px + 18px × hw, 12px)` před škálováním. Související pododkazy zůstávají seskupené. Na hranici 1600 px je přídavný růst nulový a plynule navazuje. Při výšce do 1000 px se výškový příspěvek nezapíná.

Vysoké okno 2560 × 1817 má po úpravě mezi menu a spodním blokem přibližně **449 px místo 949 px**. Při 3840 × 2160 se mezera snížila z 1205 na 686 px. Navigace tak více využívá prostor, aniž by musela neomezeně růst. Profil zůstává u spodního okraje; v nízkém okně je dostupný posunem sidebaru. Mobilní vzhled je zachovaný.

## Ověření

- Chromium a WebKit: sedm hlavních obrazovek před/po při 390×844, 768×1024, 1440×900, 1920×600, 2560×1817 a 3840×2160.
- Osm dalších obrazovek před/po při 2560×1817 a 1920×600: zákazníci, upomínky, nastavení, detail faktury, editor tvorby, archiv plateb, oznámení a předplatné.
- Celkem **232 uložených layoutových případů**; 42 referenčních dvojic pod 1600 px kontroluje shodnou geometrii a nepatrný rasterizační šum do 0.01 % pixelů. Byte-shoda se eviduje zvlášť.
- **16 interakčních kontrol** ve dvou enginech: otevření řádkové nabídky a potvrzení úhrady, zachování rozepsaného čísla při resize, dialog pravidel číslování a exportní dialog. Kontroluje se i umístění v nízkém okně, bez skutečného uložení / exportu.
- **78 existujících testů v osmi souborech** prošlo: shell/role, portrait guard, dashboard, upomínky, importní processing, bankovní import, mobilní reporty a payment flow.
- ESLint změněných komponent a kontrolních skriptů prošel. TypeScript aplikace prošel přes izolovaný config v cache. Celý původní `tsc` zároveň zahrnuje starý `responsive-review-export/`, jehož záměrně neúplné exportované soubory způsobují chyby; tento adresář ani původní tsconfig se neměnily.

[Galerie před/po](../../artifacts/workspace-proportions-2026-11-02/index.html) · [Strojový souhrn](../../artifacts/workspace-proportions-2026-11-02/verification.json) · [Pouze změny tohoto kroku](../../artifacts/workspace-proportions-2026-11-02/implementation.patch).

Jde o skutečné komponenty se syntetickými daty a izolovanými Next/API adaptéry, nikoliv potvrzení všech přihlášených produkčních stavů. Pokus o čtení skutečného lokálního Next.js s existující testovací session přesměroval dashboard, faktury a import na login; [záznam obsahuje pouze cestu a rozměrová metadata](../../artifacts/workspace-proportions-2026-11-02/next-readonly-probe.json). Nedocházelo k exportu přihlašovacích údajů nebo zákaznických dat. Fyzická klávesnice a Safari nejsou nahrazeny desktopovou emulací. Nic nebylo nasazeno.

## Opakování

```sh
node scripts/workspace-proportions-check.mjs
node scripts/workspace-proportions-check.mjs --broad
node scripts/workspace-proportions-check.mjs --engine=webkit
node scripts/workspace-proportions-check.mjs --engine=webkit --broad
node scripts/workspace-surface-check.mjs
python3 scripts/workspace-proportions-report.py
```

Běhy stejného enginu / portu spouštět postupně. Chromium používá port 4382, WebKit 4383, interakce 4384. Před/po vychází z kopie původního pracovního zdroje `/tmp/splatno-workspace-proportions-before`; `--reuse-before` opakuje aktuální stav proti již uloženým původním snímkům. Výsledky jsou konkrétním záznamem tohoto pracovního stavu, nikoliv automaticky schválenou produkční baseline.

## Navazující úprava spodního odsazení navigace

Po požadavku odstranit spodní mezeru má desktopový sidebar spodní odsazení 16 fyzických pixelů. Původních 38 logických pixelů se při růstu navigace zvětšovalo (na 54 px při šířce 2560 px). Nové odsazení se škálováním nenásobí. Profil zůstává u spodního okraje a v nízkém okně dostupný posunem navigace. Mobilní navigace se nemění. Samostatná kontrola v Chromium a WebKit při 390×844, 1440×900, 1920×600, 2560×1817 a 3840×2160: [výsledky](../../artifacts/navigation-footer-2026-11-02/results.json), [aktuální náhled](../../artifacts/navigation-footer-2026-11-02/chromium-2560x1817.png). Galerie před/po výše zachycuje stav před touto drobnou změnou odsazení.

## Navazující využití výšky navigace

Poslední úprava řeší velkou mezeru mezi menu a spodním blokem, nikoli odsazení pod profilem. Čtrnáct cílených kontrol ve skutečných komponentách se syntetickými daty v Chromium a WebKit pokrývá 1440×900, 1920×600, 2560×900, 2560×1817, 3840×2160, hraniční 1600×1817 a mobil 390×844. Kontroluje se zmenšení mezery, návaznost hlavního obsahu, nepřetékání a dostupnost profilu. [Naměřeno před změnou](../../artifacts/navigation-height-2026-11-02/before.json), [kontroly po změně](../../artifacts/navigation-height-2026-11-02/after.json), [aktuální snímek](../../artifacts/navigation-height-2026-11-02/chromium-after-2560x1817.png). Výše uvedené plošné výsledky a galerie patří předchozímu kroku; tato změna má samostatné doklady.
