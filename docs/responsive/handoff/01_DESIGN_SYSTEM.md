# 01 — Design system Splatna

Hodnoty jsou převzaté z kódu aplikace (`src/app/minimal.css`, `workspace-shell.module.css`)
a změřené na pilíři MacBook 1470 × 830. Hotové CSS je v `assets/base.css`.

## Barvy

| Token           | Hex       | Použití                                         |
| --------------- | --------- | ----------------------------------------------- |
| `--ink`         | `#17251d` | hlavní text, nadpisy                            |
| `--muted`       | `#66736b` | sekundární text, popisky, záhlaví tabulek       |
| `--line`        | `#dde3de` | okraje karet a polí, oddělovače řádků           |
| `--line-strong` | `#cbd4cd` | okraje vstupních polí                           |
| `--paper`       | `#ffffff` | karty, panely, pole                             |
| `--canvas`      | `#f5f6f2` | pozadí stránky, záhlaví tabulky                 |
| `--green`       | `#245f42` | primární akce, aktivní položka, „Zaplaceno“     |
| `--green-dark`  | `#17462f` | tmavé zelené plochy (panel „…pod kontrolou“)    |
| `--green-soft`  | `#eaf2ec` | pozadí aktivní položky menu, avatar, ikony KPI  |
| `--red`/`--red-soft`     | `#a7473e` / `#f8eae7` | „Po splatnosti“, dlužné částky |
| `--amber`/`--amber-soft` | `#94641e` / `#f8f0df` | „Čeká na úhradu / splatnost“   |
| `--blue`/`--blue-soft`   | `#3f6d62` / `#e9f0ed` | „Částečně uhrazeno“            |

Graf „Faktury v čase“: uhrazeno `#245f42`, čeká `#f3c48f`, po splatnosti `#e2706a`.
Tmavý panel „Párování / Rozpoznání pod kontrolou“: gradient `#235c42 → #123c2a`, bílý text.

## Písmo

**Inter**, tabulární číslice (`font-variant-numeric: tabular-nums`). Žádné jiné písmo.

| Role                                 | MacBook (Standard) | Tablet 1024–1180 | Max. na velkých |
| ------------------------------------ | ------------------ | ---------------- | --------------- |
| Nadpis stránky (Faktury, Zákazníci)  | 42 px / 700, −2 %  | 32 px            | 48 px           |
| Nadpis nástěnky („Dobrý den, …“)     | 32 px / 700        | 32 px            | 36 px           |
| Nadpis karty                         | 17 px / 700        | 17 px            | 20 px           |
| Eyebrow nad nadpisem (VELKÁ PÍSMENA) | 12–13 px / 600, +5 % | stejné         | stejné          |
| Buňka tabulky                        | 13 px              | 13 px            | 15 px           |
| Částka, číslo faktury                | 14 px / 600        | 14 px            | 16 px           |
| Záhlaví tabulky (VELKÁ PÍSMENA)      | 11 px / 600, +4 %  | 11 px            | 12 px           |
| Sekundární text pod hodnotou         | 12 px              | 12 px            | 13–14 px        |
| Položka menu                         | 15 px              | rail 10 px       | 18 px           |
| KPI hodnota                          | 36 px / 700        | 34–36 px         | 56 px           |
| Tlačítko                             | 13 px / 600        | 13 px            | 14 px           |
| Štítek stavu (pill)                  | 12 px / 500        | 12 px            | 13 px           |
| Pole formuláře                       | 14 px (výška 44)   | 14 px            | 15 px (výška 48) |

## Mezery, rádiusy, stíny

- Řada mezer: **4 / 8 / 12 / 16 / 20 / 24 / 32 px**. Mezi kartami 14–24 px.
- Rádius: karta **16 px**, pole a tlačítko **10 px**, štítek **6 px**, avatar a kulaté tlačítko **50 %**.
- Okraj karty 1 px `--line`. Stíny se téměř nepoužívají, rozhraní je ploché.
- Dotykový cíl na tabletu je aspoň **44 × 44 px**.

## Komponenty

### Shell (navigace + horní lišta)
- **Mobil (< 768):** horní lišta 64 px s logem, ikonou hledání, zvonkem, avatarem a hamburgerem. Menu se otevírá jako vysouvací panel.
- **Rail 84 px (768–1099):** logo (zelený čtverec), pod ním položky jako ikona 20 px a popisek 10 px. Aktivní položka má pozadí `--green-soft`. Dole avatar.
- **Sidebar 220–244 px (1100–1599):**
  - logo „splatno“ 26 px,
  - položky menu: ikona 18 px, text 15 px, řádek ~46 px; aktivní na `--green-soft`, zelený text,
  - podpoložky aktivní sekce: „› Importovat fakturu“ 13 px,
  - oddělovač, pak Nastavení,
  - dole uživatel: avatar 40 px, jméno, firma, ikona odhlášení.
- **Sidebar 264 px (≥ 1600):** vyšší řádky menu (až 64 px), text až 18 px, ikony až 22 px. Menu tak zaplní výšku a profil zůstane dole bez díry.
- **Horní lišta:**
  - vlevo hledání: pole 44 px vysoké, šířka 300–520 px,
  - vpravo „Importovat fakturu“ (sekundární), „Nová faktura“ (primární zelené) a kulatý zvonek 44 px.

### Hlavička stránky
Eyebrow, nadpis a podtitulek vlevo, vpravo jedna akce nebo souhrnná karta (např. součet
„707 456,00 Kč“). Na tabletu kompaktní varianta: nadpis 32 px, bez podtitulku.

### Karta / panel
Bílá, 16 px rádius, 1 px okraj, vnitřní padding 18–24 px. Záhlaví karty: nadpis vlevo,
odkaz nebo menu `⋯` vpravo.

### Tabulka záznamů
- Panel obsahuje filtry nahoře, záhlaví na pozadí `--canvas`, řádky s oddělovačem 1 px a stránkování dole.
- Řádek je dvoupatrový: hlavní hodnota 13–14 px, pod ní sekundární 12 px šedě.
- Typické sloupce Faktur: ☐ výběr · Faktura (číslo + VS) · Odběratel (jméno + e-mail) · Částka · Splatnost (datum + „Po splatnosti 34 dní“ červeně) · Stav (pill) · Uhrazeno (pruh + %) · `⋯`.
- Stránkování: „Zobrazuji 1–N z M“, výběr „Automaticky / 10 / 25 / 50 na stránku“, šipky a čísla stránek, aktivní stránka v zeleném čtverci.

### Štítek stavu (pill)
`Po splatnosti` (červený, ikona hodin) · `Čeká na úhradu` (jantarový) · `Částečně uhrazeno`
(modrozelený) · `Zaplaceno` (zelený, fajfka). Nikdy se nezalamuje.

### KPI karta
Kulatá ikona vlevo (40–68 px, barva podle tónu), vpravo popisek, velká hodnota a pod ní
částka. Čtyři v řadě, na mobilu 2 × 2.

### Formulář
Popisek 13 px nad polem, pole 44 px, rádius 10 px. Výběrové pole má šipku `⌄` u pravého
okraje, datum ikonu kalendáře. Mřížka 2 sloupce (tablet, MacBook), 3 sloupce (≥ 1920).
Každý řádek mřížky musí být zaplněný, žádné osamocené pole s prázdnem vedle.

### Dropzóna (nahrání souboru)
Přerušovaný zelený okraj, světle zelené pozadí, uprostřed ikona dokumentu, nadpis,
popisek formátů, tlačítko „Vybrat …“, štítky GPC / CSV a limit souboru. Vše vycentrované.
