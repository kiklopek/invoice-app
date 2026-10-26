# Nahrání bankovního výpisu — responzivní redesign

25. 10. 2026. Implementace se týká stránky `/invoices/payments` a jejího nahrávacího panelu. Globální hlavička, navigace, dashboard, faktury, archiv a finanční backend nebyly v tomto úkolu upravované.

## Výsledné rozložení

- **Desktop od 1024 px:** společná karta se dvěma sloupci přibližně 62/38. Vlevo je úvod, nahrávání a podporované formáty; vpravo tmavě zelené vysvětlení tří kroků. Obě části mají společné vnější zaoblení. Panel nemá vnitřní posouvání; výška odpovídá obsahu.
- **Tablet 768–1023 px:** nahrávání je první, pod ním kompaktní tři vysvětlující kroky. Odkaz do archivu je menší. Text se nemačká do úzkých desktopových sloupců.
- **Mobil do 767 px:** kompaktní odkaz „Zpět na platby“ vede na existující `/invoices/payments/archive`. Následuje jediný hlavní nadpis, stručný úvod, nahrávací plocha a hlavní akce přes její šířku. Velká reklamní karta archivu a opakovaný nadpis uvnitř panelu jsou skryté. Informace o párování zůstávají v malé kartě s nativním rozbalením přes klávesnici i dotyk. Nezavádí se nové spodní menu ani vlastní kopie globálního záhlaví.

## Změněné soubory a účel

| Soubor | Změna |
| --- | --- |
| `src/app/(workspace)/invoices/payments/payments-client.tsx` | Mobilní kontextový odkaz, jediný odpovídající hlavní nadpis podle šířky a stručnější úvod. Původní AppFrame a callbacky zůstávají. |
| `src/app/(workspace)/invoices/payments/gpc-import-panel.tsx` | Texty, ikona a metadata nahrávací plochy, skutečný limit a formáty, přístupná vazba chyb. Po neúspěšném uploadu se obnoví úvod stránky místo jeho skrytí kvůli pouhému názvu souboru. |
| `src/app/(workspace)/invoices/payments/bank-matching-process-info.tsx` (nový) | Společný zdroj vysvětlujících kroků pro desktop/tablet a malou mobilní rozbalovací kartu. Žádný další file input ani efekty/API volání. |
| `src/app/(workspace)/invoices/payments/payments-upload.module.css` | Výhradně lokální responzivní styly stránky: kompozice tabletu, mobilní typografie, nahrávání, informační karta, focus a omezení animace podle nastavení systému. Pouze v nahrávacím stavu umisťuje zavřeného asistenta pod obsah do vyhrazeného prostoru, aby nepřekrýval tlačítka; jeho funkčnost a umístění na jiných stránkách se nemění. |
| `scripts/payment-matching-check.mjs` | Režim `--upload-only` pro 14 skutečných rozměrů s AppShell, zachování původních regresních scénářů. Kontroly klávesnice, jediné nahrávací interakce, dlouhého názvu, chyby a opakování. Samostatné výsledky a screenshoty. |
| `scripts/payment-layout-check.mjs` | Aktualizace závislostí statického kontrolního prostředí o nové prezentační komponenty a exporty stylů. Volba `--upload-only` odděluje layout uploadu od starší, nesouvisející kontroly variant pozadí. |
| `docs/redesign/screens/bank-statement-upload/implementation.md` | Tento report. |
| `docs/redesign/visual-validation/payment-matching/before-upload-*.png`, `upload-*.png`, `upload-error-*.png`, `upload-validation.json` | Snímky před změnou a po změně, chybové stavy a naměřené výsledky. |

Repozitář obsahuje i další dříve rozpracované změny. Tento seznam vymezuje úpravy v rámci aktuálního zadání.

## Zachované chování a hranice

Používá se **jeden původní file input** s `multiple` a původní `onChange → upload()`; žádná druhá nahrávací komponenta se nemountuje. Výběr nadále ihned spustí upload prvního souboru, následné soubory zůstávají v původní frontě. Nevzniká nový potvrzovací krok ani nová drag-and-drop logika. Nativní výběr souboru je dostupný dotykem i klávesnicí.

Formáty **GPC a CSV** jsou zachované. **CAMT XML** se v popisu a štítcích nabízí pouze při původním zapnutém příznaku `camtEnabled`. Limit je podle současného `MAX_FILE_BYTES` v `/api/payments/imports` **5 MB na soubor**, nikoli 10 MB z ukázky. Skutečná validace zůstává na stejném API. Výběr souboru automaticky přechází do existujícího indeterminovaného zpracování; nevytváří se umělý mezikrok se seznamem čekajícím na další potvrzení. Při chybě zůstává název souboru a jeho velikost, čitelná chyba a možnost vybrat soubor znovu.

Původní zůstávají endpointy `POST /api/payments/imports`, načítání detailu a kandidátů, ukládání přiřazení, samostatné potvrzení `/commit`, detekce banky/účtu, finanční výpočty, zpracování fronty, oprávnění i navazující workspace párování. Nahrání nezpůsobuje nové automatické zaúčtování. Existující režim automatu a jeho popis se nemění. Neproběhly změny API, databáze, RLS ani parserů.

## Skutečně provedené ověření

- **ESLint:** tři dotčené TSX komponenty/stránky, `--max-warnings 0`, prošlo.
- **Typy:** `tsc --noEmit`, prošlo; typová kontrola prošla i v produkčním buildu.
- **Build:** `APP_BASE_URL=https://www.splatno.com node scripts/next-clean-env.mjs build .cache/invoices-build --webpack`, prošlo v izolované existující složce, včetně generování 86 rout. Žádné nasazení.
- **Vitest:** **62 testů v 5 souborech prošlo**: `gpc-import-panel.test.tsx`, `csv-statement-parser.test.ts`, `gpc-parser.test.ts`, `camt-statement-parser.test.ts`, `statement-assignment.test.ts`. Zahrnují návrat po chybě, zachování rozpracovaného a částečného výsledku, frontu souborů, načítání a potvrzení včetně zrušení, validaci formátů a přiřazování plateb.
- **Nové rozložení:** `node scripts/payment-matching-check.mjs --upload-only` — **14 layoutových a 4 funkční chybové/retry scénáře prošly**. Rozměry: 320×568, 360×740, 375×812, 390×844, 430×932, 480×844, 600×900, 767×1024, 768×1024, 820×1024, 1024×768, 1280×800, 1440×900, 1920×1080. Bez vodorovného přetečení a běhových chyb. Kontroluje se jediný file input, žádný upload bez akce uživatele, přístupné rozbalení a sbalení přes Enter, focus file inputu, správná navigace a nepřítomnost vnitřního scrollu panelu a nepřekrývání nahrávacího ovládání ani informační karty asistentem.
- **Chyba a opakování:** na 320/390/820/1440 px dlouhý název neporuší šířku; chyba API je viditelná, pole označené jako chybné, úvod obnovený. Nový výběr přejde do skutečného workspace párování. Bez automatického `/commit`.
- **Navazující párování:** `node scripts/payment-matching-check.mjs` — **16 kontrol prošlo**, včetně výběru faktur, hromadné volby, ukládání, upozornění, filtrů, oprávnění bankovního účtu a obnovy po neúspěšném zápisu.
- **Načítání:** `node scripts/gpc-loading-check.mjs` — **4 rozměry prošly** (320, 390, 768, 1440), včetně nahrávání, potvrzení, jednotlivých fází zaúčtování a reduced-motion.
- **Vnitřní scroll:** `node scripts/payment-layout-check.mjs --upload-only` — **10 rozměrů prošlo**, včetně 1280×600 a 2560×1440. Panel se přizpůsobuje obsahu a nemá vlastní scroll. Celá stránka může přirozeně rolovat.

## Ukázky

- [Mobil 390 px](../../visual-validation/payment-matching/upload-390.png)
- [Tablet 820 px](../../visual-validation/payment-matching/upload-820.png)
- [Desktop 1024 px](../../visual-validation/payment-matching/upload-1024.png)
- [Desktop 1440 px](../../visual-validation/payment-matching/upload-1440.png)
- [Příklad chyby a dlouhého názvu](../../visual-validation/payment-matching/upload-error-390.png)
- [Výsledky nových kontrol](../../visual-validation/payment-matching/upload-validation.json)

## Omezení ověření

Prohlížečové kontroly běží v Chromium nad skutečnými React komponentami a AppShell s izolovanými API fixtures. Nejde o přihlášený end-to-end test proti živým bankovním datům; nebyly odesílány produkční výpisy ani prováděny finanční zápisy. Safari, fyzická mobilní zařízení a čtečky obrazovky nebyly ručně testované. Globální navigace a sdílené akce byly ponechány podle zadání. Lokální pravidla upload stránky přesouvají zavřeného asistenta pod obsah; jeho komponenta a otevřený chat se nemění. Starší kontrola rozdílných dekorativních pozadí v `payment-layout-check.mjs` není součástí ověření uploadu; režim `--upload-only` ji nespouští. Celorepozitářový lint a kompletní sada všech testů nebyly spouštěny. Žádný commit, deployment ani migrace.

## Mobilní odsazení po doladění

Spodní rezervu 80 px nahrazuje 12 px se safe-area. Uvolněných 68 px dostala nahrávací plocha (34 px nahoře i dole). Zavřený asistent je na této mobilní stránce vpravo v úrovni kontextového návratu, mimo upload a informační kartu; desktopové rozložení se nemění. Opakovaně prošlo všech 14 rozměrů a 4 chybové/retry scénáře, včetně měření překryvů. Změna je pouze v CSS stránky. Pro toto doladění nebyl znovu spouštěn produkční build ani jednotkové testy.

## Jediný mobilní viewport a spodní mezera 15 px

Spodní odsazení je nyní 15 px plus systémová safe-area. Výška nahrávací plochy pružně vyplňuje zbývající místo v rámci minimální výšky obrazovky; text se neořezává. Na krátkých displejích do 780 px se zmenšují rozestupy a kondenzují doprovodné popisy: podporované formáty zůstávají ve štítcích, limit i hlavní akce jsou viditelné a další vysvětlení je v rozbalovacích krocích. Pod 650 px výšky se vynechá dekorativní ikona. Globální hlavička zůstává původní.

Prošlo všech 14 rozměrů a 4 chybové/retry scénáře. Mobilní výchozí stav je nyní výslovně ověřen přes `documentElement.scrollHeight <= viewportHeight + 1` včetně 320×568 a přesným měřením 15px spodního paddingu. Rozbalení informací nebo zobrazení chyby může přirozeně prodloužit stránku. Pro tuto čistě prezentační úpravu nebyl opakován build ani jednotkové testy.
