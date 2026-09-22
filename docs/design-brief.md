# Zadání pro redesign — Splatno (česká fakturační aplikace)

> Tenhle dokument je kompletní zadání. Nepotřebuješ žádný další kontext.
> Přečti ho celý, než začneš. Na konci je přesně popsaný formát, v jakém
> potřebuju výstup.

---

## 1. Kdo jsi a co se po tobě chce

Jsi zkušený produktový designer a CSS architekt. Dostáváš k nápravě reálnou
aplikaci, která funkčně funguje, ale její vizuální vrstva nikdy neprošla
systematickým návrhem — rostla sedm měsíců přílepek po přílepku.

**Nemáš přístup k souborům a nic neupravuješ.** Tvým výstupem je **specifikace
a hotový CSS kód**, který pak někdo jiný mechanicky aplikuje a ověří
automatickými testy. Proto musí být tvůj výstup konkrétní do posledního čísla:
žádné „použij větší mezery“, ale `--space-4: 16px`.

---

## 2. Produkt a jeho uživatel

**Splatno** je nástroj pro české účetnictví. Vystavuje a eviduje faktury, hlídá
DPH, importuje bankovní výpisy ve formátu GPC, páruje platby k fakturám, rozesílá
upomínky za nezaplacené faktury a dělá účetní reporty.

**Uživatel je účetní, která v aplikaci sedí osm hodin denně.** To je pro každé
tvoje rozhodnutí určující:

- **Hustota informací je přednost, ne vada.** Tohle není marketingový web.
  Účetní potřebuje vidět na jedné obrazovce co nejvíc řádků tabulky. Vzdušný
  „moderní“ design s obrovskými mezerami by tu byl krok zpátky.
- **Ale čitelnost má přednost před hustotou.** Současný stav to přepálil na
  druhou stranu — místy je text 7–9 px a šedý na šedém. Osm hodin denně na
  takovém textu je zdravotní problém, ne estetický.
- **Rychlost práce klávesnicí je kritická.** Účetní odbavuje stovky položek.
  Každé zbytečné kliknutí myší se násobí stovkami.
- **Chyba stojí peníze.** Jde o faktury, platby a DPH. Varovné a chybové stavy
  musí být nepřehlédnutelné, ne decentní.

Aplikace je celá v češtině a zůstane česká. Názvy CSS tříd a tokenů jsou
anglicky, jak je v kódu zvykem.

---

## 3. Technická omezení — nepřekročitelná

Tohle nejsou preference, ale hranice, v nichž tvůj návrh musí fungovat.
Návrh, který je poruší, je nepoužitelný.

1. **Čisté CSS.** Žádný Tailwind, žádné CSS-in-JS, žádný SASS/LESS, žádný
   CSS modules. Jen `.css` soubory s custom properties. (V projektu Tailwind
   formálně je, ale nepoužívá se ani jedna utilita a odstraňuje se.)
2. **Next.js 16 App Router, React 19.** CSS se importuje v `layout.tsx`.
   Pořadí importů určuje kaskádu.
3. **Cílová struktura souborů** (dnes jsou dva velké soubory, rozdělují se):
   ```
   src/app/styles/
     tokens.css      — jediný :root
     base.css        — reset, html/body, typografie, color-scheme, skip-link
     components.css  — .btn, .card, .table, .badge, .status, .modal, .toast…
     layout.css      — sidebar, .content, app shell, mobilní navigace
     pages.css       — zbytky specifické pro jednotlivé stránky
     print.css       — JEDINÝ @media print blok, importovaný POSLEDNÍ
   ```
4. **Právě jeden `@media print` blok v celém projektu**, v `print.css`,
   importovaný jako poslední. Hlídá to automatický test. Uvnitř print bloku
   je `!important` legitimní a nutný (A4 ≈ 700 CSS px matchuje mobilní
   `max-width` pravidla a print je musí přebít).
5. **Mimo print blok cílíme na méně než 5 `!important`** v celém projektu.
   Dnes jich je tam ~30.
6. **Musí fungovat od šířky 320 px** bez vodorovného posuvníku stránky.
   Testuje se automaticky `scrollWidth <= clientWidth`.
7. **Dark mode se NEDĚLÁ.** Navrhni ale tokeny tak, aby se dal doplnit později
   bez přepisu (sémantické názvy, ne doslovné barvy). Jediné, co se teď přidá,
   je deklarace `color-scheme: light`.
8. **Žádné externí fonty ani ikonové knihovny.** Ikony jsou inline SVG
   v jedné React komponentě. Systémový font stack zůstává.

---

## 4. Současný stav — přesná fakta z auditu

Nečti to jako stížnost, ale jako vstupní data. Všechna čísla jsou změřená.

### 4.1 Rozsah

| Soubor | Řádků | Role |
|---|---|---|
| `src/app/minimal.css` | 3 418 | Novější vrstva, vyhrává v kaskádě |
| `src/app/globals.css` | 208 (minifikované, dlouhé řádky) | Starší „neumorfní“ vrstva |
| `src/components/layout/mobile-navigation.css` | 259 | Mobilní hamburger |
| **Celkem** | **3 885** | |

### 4.2 Dva konfliktní `:root` se stejnými názvy a jinými hodnotami

Tohle je nejzávažnější nález. Existují dvě sady tokenů. Vyhrávají hodnoty
z `minimal.css` (načítá se později), hodnoty z `globals.css` jsou mrtvé.

| Token | `globals.css` (mrtvé) | `minimal.css` (platné) |
|---|---|---|
| `--ink` | `#17221c` | `#17251d` |
| `--muted` | `#6d776f` | `#66736b` |
| `--line` | `#e5e9e5` | `#dde3de` |
| `--line-strong` | — | `#cbd4cd` |
| `--paper` | `#fff` | `#ffffff` |
| `--canvas` | `#f4f6f3` | `#f5f6f2` |
| `--cream` | — | `#f8f8f4` |
| `--green` | `#1f5a3a` | `#245f42` |
| `--green-dark` | `#17452d` | `#17462f` |
| `--green-soft` | `#eaf3ed` | `#eaf2ec` |
| `--red` | `#b74437` | `#a7473e` |
| `--red-soft` | `#fbecea` | `#f8eae7` |
| `--amber` | `#b87924` | `#95651f` |
| `--amber-soft` | `#fcf3df` | `#f8f0df` |
| `--blue` | `#356d91` (**modrá**) | `#3f6d62` (**zelenkavá**) |
| `--blue-soft` | `#eaf2f7` | `#e9f0ed` |

Povšimni si `--blue`: v jedné sadě je to skutečně modrá, ve druhé zelenkavá.
Token pojmenovaný podle barvy, který barvu nedrží — to je důvod, proč chci
**sémantické pojmenování**.

**Chybí úplně:** škála mezer, škála rádiusů, typografická škála, tokeny stínů,
škála z-indexů, tokeny breakpointů, tokeny pro trvání animací.

### 4.3 Nekonzistence hodnot

- **~206 unikátních hardkódovaných hex barev** proti 18 tokenům.
- `mobile-navigation.css` nepoužívá `var()` **ani jednou** (37 hexů).
- Hodnoty tokenů jsou navíc zadrátované znovu: `#17251d` (= `--ink`) 10×,
  `#66736b` (= `--muted`) 3×, `#17462f` (= `--green-dark`) 4×.
- **Nula výskytů `rem`** v celém projektu — vše v `px`. Uživatelské zvětšení
  písma v prohlížeči proto nefunguje vůbec.
- `clamp()` použit 19×, jen v jednom souboru.

### 4.4 Breakpointy — dnes jedenáct různých

`360, 380, 420, 520, 560, 760, 780, 820, 980, 1100, 1180` plus `min-width: 981`,
`min-width: 1181` a dva dotazy na výšku okna.

**Aktivní bug:** `760` a `780` koexistují. V pásmu **761–780 px** se aktivuje
mobilní hamburger (`mobile-navigation.css`, breakpoint 780), ale desktopové
pravidlo `.content { margin-left: 220px }` se ještě neruší (`globals.css`,
breakpoint 760). Výsledek je rozbitý layout s mobilním headerem a zároveň
odsazením pro neexistující sidebar.

Přístup je **desktop-first** (`max-width`) s ostrůvky mobile-first
(`min-width: 981`, `min-width: 1181`), což je hlavní zdroj přebíjení
a `!important`.

### 4.5 Rozměry layoutu dnes

- Sidebar: `248px` (desktop), `220px` pod 1180 px, pod 760 px se mění na spodní
  lištu `64–68px`, ale zároveň existuje horní hamburger — viz bug výše.
- `.content`: `margin-left` odpovídající sidebaru, padding `34px 28px 54px`
  (tablet), `25px 16px 98px` (mobil — spodních 98 px počítá se spodní lištou,
  která tam po zapnutí hamburgeru už není → zbytečné prázdné místo).

### 4.6 Kontrast — měřené hodnoty, všechny FAIL WCAG AA

| Prvek | Popředí / pozadí | Poměr | Velikost písma |
|---|---|---|---|
| `th` (hlavičky tabulek) | `#748078` / `#f7f8f6` | **3,84 : 1** | 10–12 px, uppercase |
| `td small` (sekundární text) | `#909790` / `#fff` | **2,99 : 1** | 11 px |
| `.row-menu` | `#9aa19b` / `#fff` | **≈ 2,8 : 1** | — |
| `.status.pending` | `#95651f` / `#f8f0df` | **4,27 : 1** | 10 px, bold, uppercase |
| `--muted` na bílé | `#66736b` / `#fff` | 4,96 : 1 (těsně projde) | často použito na 8–11 px |

**Nejmenší písma v projektu:** 7 px (1×), 8 px (12×), 9 px (7×), 10 px (5×).

### 4.7 `!important` — 170 výskytů

~140 z nich je uvnitř print bloku (legitimní). Ze zbytku je nejzávažnější:

```css
*, *::before, *::after { box-shadow: none !important; }
```

Tohle globálně vypíná všechny stíny. Přitom `globals.css` obsahuje celou
propracovanou neumorfní vrstvu stínů, která je tím pádem **mrtvý kód**.
Důsledek: karty a panely jsou úplně ploché a nejde vizuálně odlišit vrstvy.
Na jednom místě se to obchází přes `box-shadow: 0 0 0 3px #fff !important`.

### 4.8 Roztříštěnost komponent

Neexistuje žádná sdílená UI komponenta. Markup se opakuje v každé stránce.

**Tlačítka** — v CSS 4 varianty (`.btn.primary`, `.btn.secondary`, `.btn.danger`,
`.btn.compact`), ale v kódu 16 různých kombinací řetězců:

| Řetězec | Výskytů |
|---|---|
| `btn secondary` | 23 |
| `btn primary` | 19 |
| `btn secondary compact` | 8 |
| + 13 dalších jednorázových modifikátorů | 1–2 každý |

Navíc existují dvě různé cesty ke stejnému vzhledu: `btn secondary danger-button`
a `btn danger`.

**Karty a panely — 21 různých tříd:** `.page-panel`, `.panel`, `.data-panel`,
`.filter-panel`, `.import-panel`, `.rules-panel`, `.report-tab-panel`,
`.access-card`, `.analytics-card`, `.app-error-card`, `.auth-card`,
`.login-card`, `.user-card`, `.report-card`, `.report-status-card`,
`.reminder-stat-card`, `.reminders-automation-card`, `.reminders-process-card`,
`.reminders-rules-card`, `.dashboard-attention-panel`, `.dashboard-balance-card`.
Z toho `.auth-card` vs `.login-card` a `.panel` vs `.page-panel` vs `.data-panel`
jsou duplicity.

**Stavové štítky — 9 variant:** `.status`, `.status.paid`, `.status.pending`,
`.status.overdue`, `.status.partial`, `.status.cancelled`, `.status.large`,
`.status-badge`, `.status-badge.unavailable`. Plus dva mimo rodinu:
`.today-task-tag`, `.policy-default-badge`. Nekonzistence: `globals.css` dává
`border-radius: 5px`, `minimal.css` to přepisuje na `999px`.

**Obaly tabulek — 3 nekonzistentní třídy:** `.table-wrap` (`overflow: visible`),
`.large-table` (`overflow: auto`, `min-width: 760px`), `.debtor-table`
(`overflow: auto`, `min-width: 640px`). Sémanticky totéž, tři různá chování.

**Prázdné stavy — 4 různé vzory:** `div.payments-empty-state` (ikona + nadpis +
text — tenhle je dobrý), `p.page-state`, `p.empty-box`, a holý text bez třídy.

### 4.9 Tabulky a jejich chování na mobilu

Tabulky jsou v téhle aplikaci to nejdůležitější. Je jich devět:

| Tabulka | Min. šířka | Mobilní chování |
|---|---|---|
| Dashboard — poslední faktury | — | ✅ karty s `data-label` |
| Seznam faktur | 760 px | ✅ karty |
| Archiv faktur | 760 px | ✅ karty |
| Zákazníci | 940 px | ✅ karty |
| Historie plateb | 1040 px, `table-layout: fixed` | ✅ karty |
| Náhled importu faktur | — | ✅ karty |
| Report — kompaktní tabulka | 100 % | vodorovný posuv (3 sloupce, přijatelné) |
| **Report — DPH a dlužníci** | **620 px** | ❌ **jen vodorovný posuv, 5 sloupců** |
| **Odblokování e-mailů** | 760 px | ❌ **v CSS nemá ani jedno pravidlo** |

Poslední dvě jsou nejhorší místa v aplikaci. U tabulky dlužníků navíc mají
řádky `role="button"` → na dotykovém displeji koliduje posouvání s klikáním.

### 4.10 Stránky aplikace

```
/login, /register, /forgot-password, /reset-password, /mfa   (bez sidebaru)
/dashboard            přehled, metriky, tabulka posledních faktur
/invoices             seznam faktur s filtry
/invoices/new         formulář nové faktury
/invoices/[id]        detail faktury, historie, upomínky, platby
/invoices/archive     archiv
/invoices/import      import faktur (OCR z PDF/foto + hromadný CSV), wizard
/invoices/payments    import bankovního výpisu GPC, 5krokový wizard s kontrolou
/invoices/payments/archive   historie plateb a výpisů
/customers            registr zákazníků
/reminders            automatické upomínky, šablony e-mailů, pravidla
/reports              4 záložky: Tržby, DPH, Pohledávky, Platby + tisk
/settings             firemní údaje, správa přístupů
```

### 4.11 Další chybějící prvky

- **Žádný toast/notifikační systém.** Deset stránek má vlastní ad-hoc hlášku.
  Objevují se mimo viewport a nikdy nemizí.
- **Chybí skip-link** (0 výskytů).
- **`htmlFor` 0 výskytů** — všech 75 `<label>` obaluje input.
- **`not-found.tsx` neexistuje nikde.**
- **Modální okno** se při zavření odmountuje → fokus spadne na `<body>`.
- **Klikatelné `<tr>`** bez `tabIndex`/`onKeyDown` → archiv faktur je klávesnicí
  zcela neovladatelný.

---

## 5. Co po tobě chci — deliverables

Postupuj v tomhle pořadí. Každá část staví na předchozí.

### A. Token systém (`tokens.css`)

Navrhni **jeden `:root`** se sémantickými názvy. U barev vycházej z platných
hodnot z `minimal.css` (sloupec vpravo v tabulce 4.2) — vzhled se nemá
zásadně změnit, má se sjednotit a zpřístupnit.

Potřebuju škály pro:

1. **Barvy — sémanticky, ne doslovně.** Místo `--green` chci role: povrchy
   (`--surface`, `--surface-raised`, `--surface-sunken`), text (`--text`,
   `--text-muted`, `--text-subtle`, `--text-inverse`), okraje (`--border`,
   `--border-strong`), akcent a stavy (`--accent`, `--accent-hover`,
   `--success`, `--warning`, `--danger`, `--info`) a jejich tlumené varianty
   pro pozadí štítků. **Ke každé dvojici popředí/pozadí, která ponese text,
   uveď spočítaný kontrastní poměr.** Vše musí splnit ≥ 4,5 : 1.
2. **Mezery.** Jedna škála, doporučuji 4/8/12/16/24/32/48/64. Pojmenuj
   systematicky. **Pro tuhle aplikaci navrhni hustší spodní konec škály** —
   účetní tabulky potřebují 4 a 8 px, ne 16 px jako minimum.
3. **Rádiusy.** 3–4 hodnoty + `999px` pro pilulky. Vyřeš konflikt štítků
   (5 px vs 999 px) — rozhodni a zdůvodni.
4. **Typografie.** Velikosti **v `rem`**, škála od nejmenší použitelné po
   nadpis stránky. **Stanov absolutní minimum a obhaj ho** — dnešních 7–9 px
   je neudržitelných, ale nechci ani nafouknuté 16px minimum, které by rozbilo
   hustotu tabulek. Ke každému stupni urči i `line-height` a `font-weight`.
   Zvaž `clamp()` tam, kde to dává smysl.
5. **Stíny.** Nejdřív rozhodni zásadní otázku: **má se globální vypnutí stínů
   zrušit, nebo ponechat?** Zdůvodni. Pokud zrušit, navrhni 2–3 úrovně elevace
   s nenápadnými stíny (ne neumorfismus). Pokud ponechat, navrhni, jak se
   vizuálně odliší vrstvy bez stínů (okraje? povrchy?).
6. **Z-index.** Pojmenovaná škála: obsah, sticky hlavička, dropdown, sidebar,
   backdrop, modal, toast. Dnes žádná neexistuje a hodnoty jsou ad-hoc.
7. **Pohyb.** Trvání a časovací funkce. Všechno musí respektovat
   `prefers-reduced-motion`.

### B. Breakpointy

Zredukuj na **čtyři**. Navrhni konkrétní hodnoty a zdůvodni je proti dnešním
jedenácti. Pro každý breakpoint popiš, **co přesně se na něm mění**.

Výslovně vyřeš:
- kolizi 760/780 (rozbité pásmo 761–780 px),
- kde přesně sidebar přechází na hamburger,
- kde tabulky přecházejí na karty,
- převrácení mobile-first ostrůvků (`min-width: 981`, `min-width: 1181`)
  do jednotného přístupu. **Doporuč, jestli jít mobile-first nebo
  desktop-first, a zdůvodni to pro tuhle aplikaci.**

### C. Layout a mřížka

- **Sidebar:** šířka na desktopu, chování na tabletu, přechod na mobil.
  Dnes 248 → 220 → spodní lišta/hamburger (rozbité).
- **Obsahová oblast:** maximální šířka obsahu (nebo bez omezení?), vnitřní
  odsazení pro každý breakpoint, boční okraj na mobilu (minimálně 16 px).
- **Mřížka stránky.** Dnes se používají `repeat(N, 1fr)` bez `minmax(0, 1fr)`,
  což způsobuje, že dlouhý obsah mřížku roztáhne za viewport. Navrhni
  systematické řešení.
- **Svislý rytmus.** Jak se skládají sekce pod sebou, jaké mezery mezi nadpisem
  a obsahem, mezi panely, mezi sekcemi. **Tohle dnes neexistuje vůbec** a je to
  hlavní důvod, proč stránky působí nesourodě.
- **Sticky prvky:** hlavička tabulky při posouvání, lišta s filtry, lišta
  s uložením změn. Urči, co je sticky a na kterém breakpointu.

### D. Mezery a odsazení — pravidla, ne jen škála

Chci **rozhodovací pravidla**, ne jen seznam hodnot:

- Vnitřní odsazení karty/panelu na každém breakpointu.
- Mezera mezi prvky ve formuláři, mezi skupinami polí, mezi sekcemi formuláře.
- Vnitřní odsazení buňky tabulky (hustý režim vs. běžný).
- Mezera mezi tlačítky ve skupině, mezi tlačítkem a jeho ikonou.
- Odsazení nadpisů — nad a pod, podle úrovně.
- **Kdy se používá `margin` a kdy `gap`.** Doporučuji `gap` všude, kde to jde,
  ale potřebuju to explicitně stanovené jako pravidlo.
- Jak se řeší kolaps okrajů (margin collapse) — nebo se mu systematicky
  vyhýbáme?

### E. Komponenty

Pro každou navrhni: anatomii, varianty, všechny stavy (výchozí, hover, focus,
active, disabled, loading), rozměry, chování na mobilu a **hotové CSS**.

Minimálně tyhle:

1. **Button** — nahradí 16 dnešních kombinací. Varianty: primary, secondary,
   danger, ghost. Velikosti: běžná, compact. Stavy včetně loading.
   **Minimální dotykový cíl 44×44 px na mobilu.** Ikona + text.
2. **Badge / Status** — sjednotí 9+2 dnešních variant. Stavy faktury:
   zaplaceno, čeká na úhradu, po splatnosti, částečně uhrazeno, stornováno.
   Musí být rozlišitelné i pro barvoslepé — **nespoléhej jen na barvu.**
3. **Card / Panel** — nahradí 21 tříd. Navrhni 2–3 varianty (běžná,
   zvýrazněná, varovná) místo jednadvaceti.
4. **DataTable** — sjednotí 3 dnešní obaly. Klíčová komponenta. Musí řešit:
   hustotu řádků, zarovnání číselných sloupců doprava, sticky hlavičku,
   zvýraznění řádku při najetí, klikatelný řádek **dosažitelný klávesnicí**,
   řazení, a hlavně **přechod na karty na mobilu** (viz F).
5. **EmptyState** — nahradí 4 vzory. Anatomie: ikona, nadpis, vysvětlení
   mechanismu, akce. Musí rozlišit „zatím tu nic není“ od „filtru nic
   neodpovídá“ — dnes se to plete a u nové organizace aplikace tvrdí
   „Tomuto filtru neodpovídá žádná faktura“, i když žádný filtr nastavený není.
6. **FormField** — label, input, nápověda, chybová hláška, povinnost.
   Musí používat `htmlFor`/`id`. Chyba **u konkrétního pole**, ne jen souhrnně
   nahoře. `aria-invalid`, `aria-describedby`.
7. **Toast** — dnes neexistuje. Varianty success/error/info. Pozice, chování
   při více zprávách, doba do zmizení (chyby nemizí samy), `aria-live`,
   chování na mobilu, respekt k `prefers-reduced-motion`.
8. **Modal** — potvrzovací dialogy. Postavený na nativním `<dialog>`.
   Focus trap, návrat fokusu na spouštěč, Escape, chování na mobilu
   (celá obrazovka?), maximální výška a posouvání obsahu.
9. **Tabs** — používá se na reportech. Klávesová navigace šipkami.
10. **Stepper** — 5krokový wizard importu výpisu. Chování na mobilu, kde se
    pět kroků vedle sebe nevejde.
11. **Dropzone** — nahrávání souborů. Stavy: výchozí, přetahování nad plochou,
    nahrávání, chyba. Musí být ovladatelný klávesnicí.
12. **Chip / aktivní filtr** — dnes chybí. Když uživatel klikne na dlužníka
    v reportu, změní se filtr bez jakékoli vizuální indikace. Potřebuju
    odstranitelný štítek s křížkem.
13. **Pagination** — historie plateb dnes není stránkovaná vůbec.

### F. Responzivní chování tabulek — řeš zvlášť a důkladně

Tohle je nejdůležitější responzivní problém aplikace.

Šest tabulek už má fungující vzor „řádek → karta“ s atributem `data-label`.
**Nastuduj ten vzor, sjednoť ho a rozšiř na zbylé dvě**, které ho nemají:

- **Tabulka odblokování e-mailů** — nemá v CSS jediné pravidlo.
- **Účetní tabulky reportů (DPH, dlužníci)** — 5 sloupců, dnes jen vodorovný
  posuv s minimální šířkou 620 px. Na displeji 360 px je to nepoužitelné.
  Navíc u dlužníků kolidují klikatelné řádky s posouváním prstem.

Urči:
- Na kterém breakpointu přesně se přepíná tabulka → karty.
- Jak vypadá karta: co je nadpis, co se zobrazí vždy, co se skryje.
- Jak se řeší číselné sloupce v kartě (zarovnání popisek ↔ hodnota).
- Kdy je naopak vodorovný posuv přijatelný a jak ho vizuálně naznačit
  (stín na okraji? „další sloupce →“?).
- Jak se v kartě řeší akce, které jsou v tabulce v posledním sloupci.

### G. Formuláře

- Rozvržení: jednosloupcové vs. dvousloupcové, kdy se co používá.
- Šířky polí podle typu obsahu (IČO má 8 znaků, název firmy 60).
- Kde je chybová hláška a jak vypadá.
- Jak vypadá povinné pole.
- Lišta s uložením: sticky dole? Kdy?
- Chování na mobilu — dnes mají `<select>` vynucenou výšku 48 px přes
  `!important`, což je symptom neexistujícího systému.
- **Velikost písma v `input` na mobilu musí být ≥ 16 px**, jinak iOS
  při zaostření stránku přiblíží.

### H. Stavy stránky

Navrhni vizuál pro:
- **Načítání** — kostra (skeleton). Dnes existuje jedna generická, která se
  používá i tam, kde se pak zobrazí formulář nebo wizard.
- **Prázdný stav** — viz EmptyState.
- **Chyba** — chyba načtení sekce vs. chyba celé stránky.
- **404** — dnes neexistuje vůbec; uživatel dostane anglickou systémovou
  stránku bez layoutu aplikace.
- **Offline / výpadek sítě.**

### I. Tisk (`print.css`)

Účetní reporty a faktury se reálně tisknou.

- Formát A4 na výšku, okraje.
- Co se skrývá: navigace, tlačítka, filtry, dekorace.
- Hlavička a patička tisku (název firmy, období, číslo stránky).
- Opakování hlavičky tabulky na každé stránce.
- Zákaz zalomení uvnitř karty a grafu.
- Grafy: dnes jsou to CSS pruhy — musí se vytisknout i bez barev pozadí.
- **Pozor:** A4 ≈ 700 CSS px, takže matchují mobilní `max-width` pravidla
  a tabulky by se vytiskly jako karty. Print je musí přebít — proto je tam
  `!important` v pořádku.

### J. Přístupnost

- Kontrast ≥ 4,5 : 1 pro všechen text (spočítej a dolož u každé dvojice).
- Viditelný `:focus-visible` na všem interaktivním — navrhni jednotný styl.
- Skip-link — vzhled a chování.
- Dotykové cíle ≥ 44×44 px.
- `color-scheme: light`.
- Jak označit povinná pole a chyby pro odečítač obrazovky.
- Stavy nesmí být rozlišené **jen** barvou.

---

## 6. Formát výstupu — důležité

Potřebuju to použitelné, ne ke čtení. Dodrž tuhle strukturu:

### Část 1 — Rozhodnutí a zdůvodnění

Stručně: jaké breakpointy a proč, mobile-first vs. desktop-first, co se stalo
se stíny, jaké je minimum velikosti písma a proč, jaký je princip škály mezer.
Maximálně jedna stránka. **Když se odchýlíš od něčeho v tomhle zadání, řekni
to tady a zdůvodni.**

### Část 2 — `tokens.css`

Hotový soubor. Každý token okomentovaný, kde se používá. U barevných dvojic
nesoucích text uveď kontrastní poměr v komentáři.

### Část 3 — `base.css`

Hotový soubor: reset, html/body, typografická škála, `color-scheme`,
`:focus-visible`, skip-link, `prefers-reduced-motion`.

### Část 4 — `components.css`

Hotový soubor, komponenty po sobě v pořadí ze sekce E. U každé komponenty
krátký komentář s anatomií a variantami.

### Část 5 — `layout.css`

Hotový soubor: shell, sidebar, obsah, mobilní navigace, mřížka, svislý rytmus.

### Část 6 — `print.css`

Hotový soubor, **jeden `@media print` blok**.

### Část 7 — Mapovací tabulka stará třída → nová

Tohle je pro mě nejdůležitější část, protože podle ní se refaktor aplikuje.
Pro každou ze starých tříd (16 kombinací tlačítek, 21 karet, 11 štítků,
3 obaly tabulek, 4 prázdné stavy) uveď, čím se nahrazuje.

| Stará třída | Nová | Poznámka |
|---|---|---|
| `btn secondary compact` | `btn btn--secondary btn--sm` | |
| … | | |

### Část 8 — Kontrolní seznam pro ověření

Co přesně se má zkontrolovat po aplikaci, aby bylo jisté, že je hotovo.
Formuluj jako ověřitelná tvrzení (např. „na šířce 360 px nemá žádná stránka
vodorovný posuv“), ať se z toho dají udělat automatické testy.

---

## 7. Na co nezapomeň

Tyhle věci se při redesignu typicky opomenou a u téhle aplikace by chyběly
nejvíc:

- **Dlouhá česká slova.** „Nepotvrzený nesoulad účtu“, „Automatické párování
  plateb“. Návrh musí počítat se zalamováním, ne předpokládat krátké anglické
  popisky.
- **Velká čísla a měna.** `1 234 567,89 Kč` v úzkém sloupci tabulky.
  Zarovnání, tabulární číslice (`font-variant-numeric: tabular-nums`).
- **Dlouhé názvy firem** v buňce tabulky — zkrátit třemi tečkami, nebo zalomit?
- **Prázdné a nulové hodnoty** — jak vypadá `0 Kč` a jak chybějící údaj.
- **Záporné částky** (dobropisy).
- **Velmi dlouhé seznamy** — tisíce faktur.
- **Stav, kdy je varování a chyba zároveň** — u importu výpisu reálně nastává,
  že se zobrazí současně zelená hláška o úspěchu a červená o chybách řádků.
- **Okno na výšku, ale úzké** (rozdělená obrazovka na desktopu).
- **Zoom prohlížeče na 200 %** — musí zůstat použitelné.
- **Velmi široké monitory** — má se obsah roztáhnout, nebo omezit?
