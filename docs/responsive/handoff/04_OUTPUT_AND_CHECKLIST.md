# 04 — Formát výstupu a kontrolní seznam

## Formát

Pro základní stránkový návrh jeden samostatný soubor HTML na **jednu stránku v jedné velikosti okna**, pojmenovaný
`<stránka>-<šířka>x<výška>.html` (např. `reminders-1024x768.html`).

- `<meta name="viewport" content="width=<šířka>">`. Návrh je pro okno přesně této velikosti.
- Do `<style>` vlož celý `assets/base.css`, pod něj CSS stránky. Žádné externí knihovny, žádný Tailwind, žádné obrázky z internetu.
- Ikony jako inline SVG z `assets/icons.js` (Lucide, stroke 2).
- Písmo Inter (systémové, bez stahování).
- Struktura: `<div class="app">` → navigace (`.nav.rail` nebo `.nav.side`) + `<main class="main">` (topbar, hlavička, obsah). Vzor najdeš v `reference/html/*.html`.
- **Statické stránky** (rodiny overview, collection, task): `body` bez posuvníku, `.app` má `height: 100vh` a poslední panel `flex: 1`.
  **Posouvací stránky** (form, document): `<body class="scrolls">`, sticky navigace a sticky náhled či akce.
- Seznamy s počtem řádků podle výšky: kontejner `.rows[data-fit][data-total][data-noun]`. Skript `fitRows()` z `reference/html/*.html` zkopíruj beze změny.
- Čísla, částky a data obal do `<span class="num">` (nezalamuje se, tabulární číslice). Zkracované texty `.ell` (tři tečky) s plným textem v `title`.
- Velikosti textu na velkých obrazovkách řeš přes `clamp()` a jednotky kontejneru (`cqi`, `cqh`) na kartách s `container-type`. Nikdy `zoom` ani `transform: scale` na celé stránce.
- Data jen z `assets/sample-data.json`, texty česky, stejné jako na pilířích.

## Kontrolní seznam (vyplň u každého výstupu)

| # | Kontrola | Jak ověřit |
|---|----------|------------|
| 1 | Pilíře nedotčené: komponenty, barvy a texty odpovídají `reference/pillars/` | vizuálně |
| 2 | Statická stránka se vejde do okna, `document.documentElement.scrollHeight <= innerHeight` | konzole |
| 3 | Pod posledním panelem je jen spodní odsazení (24 px), žádná další mezera | změřit |
| 4 | Pod posledním řádkem seznamu zbývá méně než výška jednoho řádku | `fitRows` |
| 5 | Žádný text nepřetéká: u prvků bez `text-overflow: ellipsis` platí `scrollWidth <= clientWidth` | konzole |
| 6 | Žádné tlačítko, štítek ani pole nepřesahuje svou kartu | vizuálně |
| 7 | Částky, čísla faktur, VS a data nejsou zkrácené ani zalomené uprostřed | vizuálně |
| 8 | Navigace odpovídá pásmu (rail / 220–244 / 264) a profil je dole bez díry | pravidlo 5 |
| 9 | Velké obrazovky: žádná lupa, text roste jen v mezích tabulky pravidla 6 | pravidla 6, 11 |
| 10 | Velké karty nejsou prázdné: prázdná plocha < 1 řádek obsahu | pravidlo 11 |
| 11 | Text, ikony a bloky jsou opticky vycentrované ve svém objektu | pravidlo 12 |
| 12 | Každý řádek formulářové mřížky je zaplněný | design system |
| 13 | Dotykové cíle ≥ 44 × 44 px (tablet) | změřit |
| 14 | Nepřibyla žádná funkce, kterou aplikace nemá | porovnat s pilířem |
| 15 | Sloupce jsou ve všech řádcích i v záhlaví na stejném místě (`columns: 0`, `header: 0`) | konzole |
| 16 | Karty v řadě mají stejnou horní a spodní hranu; ikony vystředěné s textem | konzole / vizuálně |
| 17 | Pozadí aplikace, logo, Esko a avatar jsou přítomné; navigace odpovídá tabulce pravidla 5 | vizuálně |
| 18 | Škálovatelné objekty (donut, graf, KPI) zabírají ≥ 75 % omezující osy karty, největší okraj ≤ max(40 px, 15 %) | změřit |

Kontrolu 2–6 lze spustit vložením do konzole prohlížeče:

```js
(() => {
  const broken = [...document.querySelectorAll(".main *")].filter(e => {
    const s = getComputedStyle(e);
    return [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
      && e.scrollWidth - e.clientWidth > 1 && s.textOverflow !== "ellipsis";
  }).map(e => e.textContent.trim().slice(0, 30));
  const kids = [...document.querySelector(".main").children];
  return {
    pageOverflow: document.documentElement.scrollHeight - innerHeight,
    gapBelowContent: Math.round(innerHeight - Math.max(...kids.map(k => k.getBoundingClientRect().bottom))),
    rows: [...document.querySelectorAll(".rows[data-fit]")].map(b => b.dataset.kept),
    columns: Math.max(0, ...[...document.querySelectorAll(".rows")].flatMap(box => {
      const rs = [...box.children].filter(r => r.style.display !== "none");
      return rs.length < 2 ? [] : [...rs[0].children].map((_, k) => {
        const ls = rs.map(r => r.children[k]?.getBoundingClientRect().left).filter(x => x != null);
        return Math.round(Math.max(...ls) - Math.min(...ls));
      });
    })),
    brokenText: broken,
  };
})();
```

U statické stránky musí vyjít `pageOverflow: 0`, `gapBelowContent: 24`, `columns: 0` a `brokenText: []`.


## Rozšíření pro otevřené prvky

Pro každou otevřenou vrstvu a interaktivní stav použít samostatnou scénu a rozšířený
checklist v dokumentu 05. Čtrnáct kontrol výše nadále platí pro základní stránku;
kontroly výplně plátna a zbytku pod řádky se nepřenášejí na samotný malý popup.
Scénáře a skutečné použití určuje dokument 06. Skript výše hledá text jen v `.main`:
portál mimo `.main`, top layer, fokus ani otevřený systémový picker tím neověří.
U každé kontroly uvést PASS/FAIL/N/A/NEOVĚŘENO, nepovažovat spuštění skriptu za vizuální revizi.
