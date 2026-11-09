# Plynulost scrollování landing page

Ověřeno 7. listopadu 2026 v Chromium 151.0.7922.34, na lokálních produkčních sestaveních Next.js 16.4.1. Bez nasazení.

## Příčina a oprava

Globální `html, body { overflow-x: hidden }` mění také vypočtené `overflow-y` těla na `auto`. Dekorativní přesahy landing page vytvořily uvnitř `body` další svislý scrollovací kontejner. Chrome do něj zachytával scrollovací gesta; hlavní dokument se při jednom souvislém gestu vůbec neposunul. Přilepená hlavička se navíc vztahovala k tomuto vnitřnímu kontejneru.

V `src/components/landing/landing.module.css` nyní `body:has(.page)` používá `overflow-x: clip`. Vodorovné přesahy zůstávají oříznuté a svislý pohyb zpracovává dokument. Pravidlo se aktivuje pouze v přítomnosti landing page. Rozmazání hlavičky, CountUp, pozadí, animace, jejich pořadí a responzivní zoom jsou zachované.

## Měření

Původní a opravený build běžely odděleně na portech 3100 a 3101. Testy neběžely současně s buildem ani s jiným browserovým testem. Viewport měl výšku 900 px a měřítko zařízení 1. Každá šířka prošla dvěma opakováními: scroll dolů a zpět po načtení, potom znovu po doběhnutí animací. Vstup tvořily skutečné události kolečka, nikoli vlastní animování pozice stránky.

| Ukazatel | Před opravou | Po opravě |
| --- | --- | --- |
| Paint události při ustáleném scrollu, 1440 px | 162 / 162 | 0 / 0 |
| Paint události při ustáleném scrollu, 1920 px | 156 / 158 | 0 / 0 |
| Rasterizace při prvním průchodu, 1440 px | 37–41 ms | 28–30 ms |
| Rasterizace při prvním průchodu, 1920 px | 54–67 ms | 47–49 ms |
| 95. percentil intervalu snímků | 17–18 ms | 17–18 ms |
| Posuny obsahu během opravených průchodů | — | CLS 0 |

Záznamy neukazují trvalý problém s frekvencí snímků. Potvrzený problém spočívá hlavně v zachycení vstupu nechtěným kontejnerem a ve zbytečném překreslování. Čísla jsou lokální měření v automatizovaném Chromu, nikoli záruka stejného výsledku na každém zařízení.

Samostatné diagnostické varianty vypnuly rozmazání hlavičky, přechody odhalovaných prvků nebo CountUp. Žádná neodstranila vnitřní scroll. Varianta s jedinou změnou `body { overflow-x: clip }` jej odstranila na obou desktopových šířkách. Vypnutí CountUp se kontroluje přímo v doručeném produkčním JavaScriptu; diagnostika selže, pokud nenajde očekávanou podmínku.

## Browserová regrese

`scripts/landing-scroll-browser-check.mjs` porovnává českou a anglickou stránku při 1440, 1920 a 390 px, s běžným i omezeným pohybem. Pro každou variantu zaznamenává screenshot úvodu a celé stránky, geometrii sekcí a výšku hlavičky, chyby JavaScriptu a výsledky nativního scrollovacího gesta.

Kontroluje:

- Gesto dolů o 900 px posune dokument, `body.scrollTop` zůstane 0 a opačné gesto ihned posune dokument zpět o 450 px.
- Hlavička zůstává přilepená k hornímu okraji viewportu.
- Sekce mají stejné souřadnice a rozměry jako před změnou; nevzniká vodorovný přesah.
- Všechny prvky se odhalí, odkazy dosáhnou příslušných sekcí a omezený pohyb nechává obsah viditelný.
- Obsah české i anglické stránky je viditelný také bez JavaScriptu.

Výsledek: všech 24 scénářů před/po prošlo, včetně shody geometrie sekcí a výšky hlavičky. Na opraveném desktopu souvislé gesto posunulo dokument o plných 900 px a opačné gesto o 450 px; vnitřní scroll zůstal na nule. Všechny snímky úvodu (12 dvojic) mají nulový pixelový rozdíl. Celostránkové snímky mají stejné rozměry; drobné rozdíly vykreslení zabírají nejvýše 0,015 % pixelů. Porovnání počítá pixel jako odlišný při rozdílu větším než 2 v některém barevném kanálu.

Obě izolovaná produkční sestavení prošla včetně TypeScriptu. Související Vitest testy: 2 soubory, 10 testů prošlo. ESLint obou ověřovacích skriptů a `git diff --check` prošly.

Po odstranění vnitřního kontejneru se dekorativní přesah na konci započítává do hlavního dokumentu: naměřená scrollovatelná výška je o 20 px při 1440 px a o 27 px při 1920 px větší. Rozměry samotných sekcí se nemění.

## Reprodukce a artefakty

```sh
# Produkční build a server; použít dvě izolované kopie zdrojů před a po změně.
APP_BASE_URL=https://www.splatno.com corepack pnpm build
APP_BASE_URL=https://www.splatno.com corepack pnpm start --port 3100

# Diagnostika původního buildu včetně dočasné opravy pouze v prohlížeči.
SCROLL_REPEATS=1 SCROLL_VARIANTS=normal,no-blur,no-reveal,no-countup,single-scroll node scripts/landing-scroll-check.mjs baseline http://localhost:3100

# Stejný profil dvakrát pro každý build.
SCROLL_VARIANTS=normal node scripts/landing-scroll-check.mjs comparison-before http://localhost:3100
SCROLL_VARIANTS=normal node scripts/landing-scroll-check.mjs comparison-after http://localhost:3101
node scripts/landing-scroll-browser-check.mjs http://localhost:3100 http://localhost:3101

corepack pnpm exec vitest run src/lib/landing-static.test.ts src/components/landing/count-up.test.ts
corepack pnpm exec eslint scripts/landing-scroll-check.mjs scripts/landing-scroll-browser-check.mjs
```

- [Původní výkonnostní výsledky](../../artifacts/landing-scroll/comparison-before/results.json)
- [Opravené výkonnostní výsledky](../../artifacts/landing-scroll/comparison-after/results.json)
- [Diagnostické varianty](../../artifacts/landing-scroll/baseline/results.json)
- [Browserové výsledky](../../artifacts/landing-scroll/browser/results.json)
- [Pixelové porovnání screenshotů](../../artifacts/landing-scroll/browser/visual-comparison.json)
- Screenshoty jsou v `artifacts/landing-scroll/browser/`, komprimované Chrome trace záznamy ve složkách jednotlivých měření. Artefakty jsou lokální a ignorované Gitem.

Build v původním checkoutu blokuje existující export `responsive-review-export/`, který TypeScript zahrnuje mezi zdroje a který obsahuje neúplné ukázky. Obě produkční sestavení proto používají izolované kopie bez exportů, se stejnými zdroji aplikace, konfigurací a závislostmi. Konfigurace checkoutu ani exporty se kvůli ověření nemění. Lokální HTTP hodnotu `APP_BASE_URL` přepsal pouze proces buildu a serveru; soubory prostředí zůstávají nedotčené.
