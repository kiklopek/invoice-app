# Designový audit Splatna — 25. 10. 2026

Našel jsem **6 potvrzených designových problémů a 3 místa ke zlepšení**. Nejvyšší prioritu má překrývání ovládání asistentem Esko: na telefonu 390 × 844 není možné běžným kliknutím přejít na další stránku oznámení. Stejný problém se reprodukoval v Chromium i WebKitu.

[Otevřít vizuální přehled se screenshoty](./index.html).

## Potvrzené problémy

| Priorita | Místo | Nález | Doporučená změna |
| --- | --- | --- | --- |
| P1 | Oznámení a společný asistent | Esko překrývá tlačítko „Další“ a zachytává kliknutí. | Umístit asistenta mimo důležité ovládání; ověřovat i konec stránky, nejen první obrazovku. |
| P2 | Desktopové záhlaví | Nástěnka a faktury mají lištu o 16 px výše než reporty, zákazníci, nastavení a další sekce. | Sjednotit horní odsazení ve společném rozložení. |
| P2 | Archiv faktur | Zaplacené a stornované faktury nemají viditelné označení stavu. | Doplnit jednoznačné štítky „Zaplaceno“ / „Stornováno“. |
| P2 | Nástěnka, údaje faktury | Některé malé informační texty mají nedostatečný kontrast vůči bílé kartě. | Použít tmavší sekundární text. |
| P2 | Nástěnka, zákazníci, nastavení | Typografie klesá až na 8–11 px; při editaci e-mailu zákazníka je text menší než v běžných formulářích. | Sjednotit velikosti pomocných textů a vstupů. |
| P2 | Archiv plateb | Datum je vypsáno jako `2026-10-20`, zatímco faktury používají český formát. | Použít společný formát data, například `20. 10. 2026`. |

### 1. Esko blokuje stránkování oznámení

**Reprodukce:** otevřít historii s více než 30 oznámeními, viewport 390 × 844, posunout na konec a kliknout na „Další“. Tlačítko leží přibližně na `x=299, y=779`, velikost 58 × 36 px. Hit test ve středu tlačítka vrátí tlačítko asistenta, nikoliv stránkování; běžné kliknutí v Playwrightu selže kvůli zachytávání události asistentem. Potvrzeno oběma prohlížeči. Na 320 px je tlačítko jinde a kliknutí projde — kontrola jednoho telefonu proto chybu snadno přehlédne.

[Chromium — zablokované stránkování](./notifications-390-pagination.png) · [WebKit — stejný stav](./webkit-notifications-390-pagination.png).

Stejný plovoucí prvek geometricky zasahuje také do vstupu v nastavení, textového pole e-mailové šablony a tlačítka „Přidat kategorii“ v upomínkách. U těchto dalších míst měření potvrzuje překryv části ovládání; netvrdím, že celý prvek nelze ovládat. [Upomínky](./reminders-390.png) · [E-mailová šablona](./settings-email-template-390.png).

**Zdroj:** `src/components/esko/esko-assistant.module.css:4` — fixní poloha vpravo dole, z-index 60; obsah stránek s tímto prostorem nepočítá.

### 2. Desktopová lišta mezi sekcemi poskakuje

Při 1440 × 900 je vršek lišty na nástěnce a fakturách v `y=20 px`. V reportech, zákaznících, upomínkách, nastavení, šablonách a oznámeních je v `y=36 px`. Výška ovládání je shodně 44 px, ale poloha se při navigaci změní. Rozdíl je měřitelný, nejde pouze o optický dojem.

[Srovnání dvou skutečně vykreslených lišt](./evidence-header-alignment.png).

**Zdroj:** `src/app/minimal.css:173` nastavuje společnému obsahu horní padding 36 px; nástěnka a faktury mají vlastní přepsání. Vhodné je sjednotit rozložení nad stránkami, nikoliv přidat další individuální korekce.

### 3. Archiv vizuálně neoznačuje storno

V testovacím archivu jsou dvě zaplacené faktury a jedna stornovaná. Karty neukazují slovní stav; u storna je pouze nulová uhrazená částka a pomlčka místo data úhrady. Čtenář musí význam odvozovat z jiných údajů. Stejný údaj chybí i v desktopovém řádku.

[Archiv — třetí karta je stornovaná, ale nemá označení](./invoices-archive-390.png).

**Zdroj:** `src/app/(workspace)/invoices/archive/page.tsx:172` vykresluje číslo, zákazníka, částky a data, ale žádnou buňku stavu. Přitom responsive CSS obsahuje pravidla pro `.archive-invoice-status`; odpovídající prvek v JSX není.

### 4. Slabý kontrast drobných údajů

Na bílé kartě nástěnky má barva VS a popisku splatnosti `#809086` kontrast přibližně **3,36 : 1**. E-mail a počet upomínek s `#77877c` mají přibližně **3,79 : 1**. Jde o texty 10–11 px, nikoliv o velký nadpis nebo dekoraci. Pro běžný text požaduje [WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) alespoň 4,5 : 1.

[Nástěnka na mobilu](./dashboard-390.png).

**Zdroj:** `src/app/(workspace)/dashboard/dashboard-summary.module.css:2724` a následující pravidla pro `invoiceCardSide`, `invoiceCardDue`, `invoiceCardReminders` a e-mail.

Toto je cíleně ověřený nález nad konkrétními barvami. Není to tvrzení, že byl certifikován kontrast úplně každého prvku aplikace.

### 5. Velikosti textů nejsou sjednocené

Nastavení uživatelů má text „Odebrat“ 8 px, nástěnka VS a popisek splatnosti 10 px a e-mail 11 px. Při editaci kontaktu zákazníka je vstup široký 180 px s textem 11 px, zatímco běžné mobilní formuláře používají větší text. Dlouhá e-mailová adresa se proto při úpravě hůře kontroluje.

[Editace zákaznického e-mailu](./customers-390-edit.png) · [Nastavení uživatelů](./settings-390.png).

**Zdroj:** `src/app/minimal.css:3214`, `.customer-email-edit input`; obdobné pravidlo pro telefon na řádku 3198. Malé členské akce jsou zděděné z `.members-list button` v `src/app/globals.css:65`.

Doporučení: u mobilních textových vstupů sjednotit 16 px; pomocné informace držet typicky na 12–14 px. Samotná malá vykreslená ikona nebo checkbox zde automaticky neznamenají malou klikací plochu — u řady prvků je plocha správně rozšířená přes label nebo tlačítko. Audit tyto případy nepočítá automaticky jako porušení přístupnosti; [SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) má také výjimky pro rozestupy a alternativní ovládání.

### 6. Platby používají jiný formát data

Archiv plateb vypisuje datum `2026-10-20`. Ve stejném prostředí archiv faktur zobrazuje `20. 10. 2026`. Aplikace tak pro stejný typ informace střídá technický a český zápis.

[Archiv plateb](./invoices-payments-archive-390.png).

**Zdroj:** `src/app/(workspace)/invoices/payments/archive/payments-archive-client.tsx:330` přímo vypisuje `payment.booked_on` místo společného formátování data.

## Doporučení k dalšímu redesignu

**P3 — Přechod na tablet.** Při 767 px funguje seznam jako mobilní karty. Při 768 px se přepne na tabulku širokou 1090 px v dostupném prostoru přibližně 734 px a zároveň se zásadně změní společná navigace. Akce a další sloupce je nutné hledat vodorovným posunem. Je to legální interní scroll tabulky, nikoliv přetékání celé stránky. Doporučuji promyslet samostatný tabletový stav nebo ponechat karty do šířky, při které se tabulka opravdu vejde. [768 px](./invoices-768.png) · [767 px](./invoices-767.png).

**P3 — Délka formuláře upomínek.** Konfigurace pouhých čtyř kroků má při 390 px dokument vysoký přibližně 2177 px. Číslo a jednotka se u každého kroku skládají pod sebe a uložení kategorie je až pod celým seznamem. Pomohla by kompaktnější dvojice „počet + před/po splatnosti“ a dostupnější uložení. Jde o návrh ke zvýšení pohodlí, nikoliv o nefunkční formulář. [Celá stránka](./reminders-390.png).

**P3 — Společné designové proměnné.** Velikosti a rozestupy se dnes skládají z obecných stylů, responsive souboru a dalších přepsání v modulech stránek. Rozdílné horní odsazení a velikost editace kontaktů jsou konkrétní důsledky. Doporučuji sdílené proměnné pro horní lištu, formulářové vstupy, sekundární text a breakpoint tabulky; nevytvářet další výjimku pro každou stránku.

## Co prošlo a co selhalo pouze v testech

Nezjistil jsem horizontální přetékání **celého dokumentu** v cíleně měřených stavech. Některé tabulky a grafy mají vlastní horizontální scroll; samotný výskyt jejich vnitřních prvků mimo viewport nebyl označen jako chyba stránky. Otevřené nastavení grafu nástěnky zůstalo na 320, 390 a 767 px uvnitř obrazovky. Nahrávání a kontrola dokumentů, platební pracovní plocha, reporty a předplatné prošly příslušnými existujícími vizuálními scénáři.

V devíti existujících kontrolních skriptech prošlo 178 dílčích scénářů. Čtyři skripty přesto skončily chybou:

- Oznámení: skutečně blokované stránkování asistentem, uvedené výše.
- Seznam faktur: zastaralý předpoklad, že souhrn obsahuje jedinou SVG ikonu; aktuálně jsou dvě. Samotný počet ikon není důkaz designové chyby.
- Nástěnka: starý test hledá vyhledávací pole přímo na mobilní stránce místo otevření lupy. Nový audit pracuje s aktuálním rozložením a nevykazuje pád komponenty.
- Detail faktury: geometrické srovnání narazilo na rozdíl 1 px proti toleranci. Tento výsledek není vydáván za závažný vizuální problém; mobilní detail navíc prošel v samostatné sadě.

Doplňkově prošlo 32 kontrol kroků onboardingu a 17 scénářů přihlašovacích čekacích/chybových stavů. Jeden desktopový přihlašovací scénář selhal na zastaralém selektoru `main > div`; nejde o potvrzený pád formuláře. Přihlašovací přesměrování do MFA je ověřeno jen pomocí testovacích odpovědí, nikoliv reálným ověřením účtu.

Logy a strojově čitelná měření jsou v tomto adresáři. Staré automatické testy tedy nejsou zaměněné za seznam potvrzených chyb produktu.

## Rozsah a limity

Cílený audit obsahuje **110 zachycených stavů**: Chromium 77 a WebKit 33, včetně otevřených panelů, editace kontaktu a stránkování. Základní matice pokrývá 100 kombinací stránky a viewportu; zbytek jsou interakční stavy. Šířky Chromium: 320, 390, 767, 768, 1024 a 1440 px; WebKit: 390, 768 a 1440 px.

Pracovní stránky: nástěnka, faktury, reporty, zákazníci, upomínky, nastavení, e-mailové šablony, oznámení, archiv faktur a archiv plateb. Doplňkové existující scénáře zahrnují detail faktury, ruční fakturu, OCR upload/review, nahrání bankovního výpisu, párování, předplatné a jejich vybrané chybové/prázdné stavy. Veřejná úvodní stránka, přihlášení, registrace a oba formuláře obnovy hesla byly otevřeny v místním Next.js serveru na mobilu a desktopu.

Pracovní obrazovky používají skutečné komponenty s testovacími API daty. Nejde o audit přihlášeného produkčního účtu, skutečných bankovních dat ani fyzického iPhonu. Nebyly odeslány skutečné platby, upomínky ani změny firmy. Operátorská konzole, živý průchod MFA, e-mailové pozvánky a každá možná kombinace oprávnění nejsou tímto vizuálním auditem plně pokryté.

Aplikační zdrojové soubory se při tomto auditu neupravovaly. Výstupem jsou zjištění, screenshoty a reprodukovatelný prezentační audit.

## Opakování

- `node scripts/application-design-audit.mjs` — pracovní stránky v Chromium.
- `node scripts/application-design-audit.mjs --webkit` — stejné základní obrazovky ve WebKitu.
- `node scripts/application-design-audit.mjs --public` — navíc veřejné stránky na `localhost:3000`.
- `--routes=/invoices/archive,/invoices/payments/archive` — pouze vybrané pracovní stránky.

Výsledky: `measurements.json`, `webkit-measurements.json`, `script-results.json` a jednotlivé logy. Auditovací Vite server používá port 4398; souběžně nespouštět dvě varianty tohoto skriptu.
