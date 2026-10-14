# Responzivita landing page

Rozložení určuje šířka viewportu v CSS pixelech, nikoli značka zařízení. iPad na výšku může používat tabletové rozložení a na šířku desktopové; zvětšení prohlížeče může přepnout stránku do užšího rozložení.

| Šířka | Hlavní rozložení |
| --- | --- |
| do 640 px | Mobil: hero nad dashboardem, proces pod sebou, mobilní přepínač placení. |
| 641–1080 px | Tablet: hero vedle oříznutého dashboardu, text vedle cyklu, proces pod sebou. Výška dashboardu se řídí textem, maskot se do ní nepočítá. |
| od 1081 px | Desktop: plný dashboard vedle hero, proces ve třech sloupcích. |

Dílčí sekce mají vlastní hranice podle prostoru potřebného pro obsah: FAQ a karty cílových skupin se mění při 980/981 px, text u ikony videa se zobrazuje od 1440 px. V užších rozloženích má video stále přístupný název. Od 1440 px roste měřítko landing page plynule; prohlížeče bez podpory výpočtu poměru délek v CSS ponechají běžné desktopové měřítko.

Velikost hero nadpisu, desktopové odsazení a mezery přecházejí plynule mezi tabletovým a desktopovým rozměrem. Proces mezi 640 a 768 px plynule zvětšuje typografii a ilustrace. Změna počtu sloupců zůstává okamžitá a nepoužívá animaci rozložení; text se může přirozeně přelomit na další řádek.

## Ověření

```sh
corepack pnpm exec playwright test --config playwright.faq.config.ts landing-breakpoints.spec.ts landing-faq.spec.ts
corepack pnpm exec playwright test --config playwright.faq.config.ts landing-process-motion.spec.ts
corepack pnpm exec playwright test --config playwright.faq.config.ts public-responsive.spec.ts --project desktop --grep '/ drží'
corepack pnpm lint
corepack pnpm typecheck
```

Test přechodů kontroluje českou a anglickou verzi v Chromium a WebKit při 37 šířkách od 320 do 3840 px, včetně šířek těsně před a po hranicích. Stránku mění bez obnovení oběma směry, se zavřenými i otevřenými odpověďmi a měsíčním i ročním placením. Kontroluje vnitřní ořezání textu, hodnoty dashboardu, viditelnost obsahu a překrytí hlavních akcí. Snímky hero a procesu pro mobil, tablet a desktop ukládá jako přílohy testů pro ruční vizuální kontrolu.

Samostatné FAQ testy ověřují klávesnici, funkčnost bez JavaScriptu, omezení pohybu a čitelnost při 200% zvětšení. Při dalších úpravách kontrolovat také ceník, finální CTA a obě jazykové verze. Dekorativní oříznutí spodní části tabletového dashboardu je záměrné; nesmí se zaměnit za oříznutí textů či ovládání.

## Scroll animace procesu

Každý text kroku, ilustrace a spojovací šipka se odhalí při vlastním vstupu do viewportu. Na mobilu a tabletu tak další krok čeká na posun stránky; desktopové kroky, které vstoupí současně, mají krátké odstupňování v pořadí 01–03. Odhalení proběhne jednou a nemění výšku procesu. Bez JavaScriptu nebo při omezení pohybu je obsah ihned viditelný; změna této preference během prohlížení také vypne skrývání.

Test scroll animací projde skutečným scrollováním obě jazykové verze v Chromium a WebKit na šířkách 390, 768, 1024, 1440 a 1920 px. Hlídá odhalování, pořadí desktopových kroků, zachování výšky, jednorázový průběh, omezení pohybu a zobrazení bez JavaScriptu.
