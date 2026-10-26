# Společné ovládací ikony

Pro stejnou akci používat jednu komponentu:

| Akce | Komponenta | Varianta v knihovně `Icon` |
| --- | --- | --- |
| Zavřít / zrušit filtr | `CloseIcon` z `@/components/close-icon` | `name="close"` |
| Rozbalit / sbalit | `ChevronDown` z `@/components/chevron-down` | `name="chevron-down"` |
| Otevřít filtry | `FilterIcon` z `@/components/filter-icon` | `name="filter"` |

Všechny varianty v `Icon` delegují na stejnou komponentu. Výchozí velikost je 18 × 18 px, viewBox 24 × 24, tah 2 a zaoblené konce. Velikost lze přizpůsobit kontextu bez vytváření jiné kresby.

`control-icons.css` řeší zarovnání, neinteraktivní SVG, otáčení a omezený pohyb. Stav rozbalení řídit nativním `<details open>` nebo `aria-expanded` na tlačítku. Nepřidávat další CSS `rotate`, protože by se s centrálním `transform` sečetl.

Do rozbalovacího `<summary>` vložit `<ChevronDown />`; tím se nativní trojúhelník skryje. Nevytvářet šipky z CSS okrajů nebo textových znaků. Pro navigaci na jinou stránku zůstává směrová šipka `arrow-right` / `arrow-left`.

Nativní `<select>` používá společnou SVG kresbu `--select-chevron-image` z `minimal.css`. Lokální styly nemají obsahovat vlastní kopie SVG šipky.

Ikony jsou dekorativní. Název akce patří do textu nebo `aria-label` ovládacího prvku. Malá ikona sama nemá určovat velikost klikací plochy.

Ověření: `node scripts/control-icons-check.mjs` kontroluje zarovnání, stejné filtry přes oba veřejné vstupy, otevírání, zavírání, nativní selecty a omezený pohyb na 320, 390 a 1536 px.
