# 05 — Otevírací prvky a interaktivní stavy

Rozšíření balíčku, 7. 11. 2026. **Specifikace k návrhu, nikoli schválené mockupy nebo důkaz opravy aplikace.**
Rozsah zahrnuje všech 15 pracovních stránek a jejich sdílené prvky. Podrobný registr
je v `06_INTERACTION_INVENTORY.md`. Landing a autentizace nejsou součástí tohoto balíčku.

## Co se má odevzdat

Nestačí zavřená stránka. Pro každý existující prvek dodat scénu s otevřeným prvkem
nad skutečným kontextem stránky: musí být vidět spouštěč, okolní obsah a všechny akce.
Používat jen vzorová data z `assets/sample-data.json`. Pilíře a funkčnost zachovat.
Současné obrázky pilířů nedokládají všechny otevřené stavy. Chybějící reference označit
jako „návrh podle pravidel“, nikdy jako schválený stav.

## Rodiny a návrhové rozměry

Číselné rozměry níže jsou doporučení pro nové mockupy mezi pilíři a nad nimi.
Otevřené stavy na mobilu a MacBooku nejprve zachytit ze současné aplikace; neměnit je automaticky.
Všechny šířky jsou omezené dostupným viewportem, žádná minimální šířka nesmí vyvolat přetečení.

| ID | Rodina | Šířka na tabletu / desktopu | Výška a malé okno |
| --- | --- | --- | --- |
| I01 | Potvrzovací dialog | 400–480 px | Přirozená výška, dlouhý text se zalomí, akce zůstanou dostupné |
| I02 | Formulářový dialog | 560–720 px | Při nedostatku výšky scroll těla, viditelný nadpis a akce |
| I03 | Náhled PDF / dokumentu | Do 1120 px, podle poměru dokumentu | Náhled a akce se vejdou do dostupné výšky; obsah dokumentu lze posouvat |
| I04 | Menu akcí pod ⋯ / kontextová nabídka | 220–320 px, podle obsahu | Překlopit nad spouštěč u dolního okraje; dlouhý seznam má vnitřní scroll |
| I05 | Select a seznam možností | Aspoň šířka pole, nejvýše dostupná šířka | Vybraná položka, disabled, dlouhé volby, scroll; nativní select zůstává nativní |
| I06 | Našeptávač / vyhledávání | Šířka pole; složitý výběr do 440 px | Načítání, výsledky, nic nenalezeno, chyba, dlouhý seznam |
| I07 | Filtry / období / datumový rozsah | 320–560 px podle počtu polí | Na tabletu pole přeskupit; na mobilu zachovat existující sheet či dialog |
| I08 | Tooltip / vysvětlení údaje | 200–320 px, krátké sdělení | Dle obsahu, překlopit u okrajů; nesmí vyžadovat hover jako jediný přístup |
| I09 | Panel oznámení | 360–440 px | Scroll seznamu, dostupné záhlaví a odkaz na všechna oznámení |
| I10 | Vysouvací navigace / panel | Dle existujícího shellu | Na mobilu bezpečné okraje a zavření; na desktopu zachovat rail/sidebar |
| I11 | Sbalitelná sekce / accordion | Šířka rodičovského panelu | Otevření přirozeně posune obsah; nepřekrývá následující sekci |
| I12 | Toast / výsledek operace | Do 420 px | Dlouhý text a detail se zalamují; zavírací tlačítko zůstává dostupné |
| I13 | Nemodální panel Esko | Zachovat existující varianty | Stránka zůstává ovladatelná, panel respektuje viewport a klávesnici |
| I14 | Vnořený výběr při párování | Výběr faktury do 440 px, širší popover do 560 px | Samostatný scroll možností, plné částky a čísla faktur |
| I15 | Ochrana orientace | Zachovat současné chování | Otočení zařízení nesmaže hodnoty ani rozpracovanou operaci |

Dialog se na 2560 ani 4K neroztahuje na celé okno jen kvůli prostoru. Pravidla 2 a 11
pro vyplnění stránky se **nevztahují na krátké dialogy, menu, tooltipy ani prázdné stavy**.
Ty mají velikost podle obsahu; nepřidávat prázdné řádky nebo nové funkce pro zaplnění.
Barvy, písmo, tlačítka a pole převzít z `01_DESIGN_SYSTEM.md`; nepřidávat nový styl.

## Společná pravidla interakce (I-R01 až I-R12)

1. **I-R01 — Dostupný prostor.** Okno i ovládání držet v aktuálně viditelné části viewportu.
   Doporučená rezerva je 12 px na mobilu a 24 px na desktopu, navíc safe-area.
   Klávesnice může dostupnou výšku zmenšit; nepočítat jen s původní výškou displeje.
2. **I-R02 — Kotvení.** Menu, tooltip a našeptávač mají jasný vztah ke spouštěči.
   U dolního okraje otevřít nahoru, u pravého posunout dovnitř. Po scrollu či resize
   přepočítat polohu nebo zavřít podle existujícího chování. Nechat scrollovat vlastní seznam.
3. **I-R03 — Vrstvy.** Nabídku neořízne tabulka, karta ani sticky záhlaví.
   Menu uvnitř dialogu zůstane nad jeho obsahem. Samotný vysoký z-index není doklad úspěchu.
   Otevření potvrzení z menu nejprve zavře původní menu, pokud aplikace nemá doložený jiný postup.
4. **I-R04 — Modální a nemodální režim.** Modální dialog blokuje pozadí a drží fokus uvnitř.
   Běžná nabídka nebo nemodální Esko takový blok nepřidává. Zachovat rozdíl současných komponent.
5. **I-R05 — Zavírání a fokus.** Doložit zavírací tlačítko, Escape a návrat fokusu na spouštěč.
   Escape nejprve zavře nejvnitřnější otevřený prvek. Kliknutí mimo a blokování zavření
   při operaci zachovat podle konkrétního prvku; nezavádět plošně jiný způsob zavírání.
6. **I-R06 — Klávesnice.** Celý tok musí jít projít bez myši. Tab a Shift+Tab nesmějí uvíznout
   ve skrytém obsahu. Select/listbox/combobox používá své odpovídající ovládání; neoznačovat
   obyčejný seznam odkazů jako ARIA menu bez implementace příslušného ovládání.
7. **I-R07 — Obsah a čísla.** Dlouhé názvy se zalomí nebo mají dostupnou úplnou hodnotu.
   Částky, VS, čísla faktur a data zůstávají úplné. V dialogovém nadpisu lze zalomit text
   před číslem; samotný identifikátor se neořízne. Odstranění obsahu není řešení přetečení.
8. **I-R08 — Akce a scroll.** U dlouhého dialogu má přednost jeden scroll těla.
   Záhlaví a patička nesmějí zakrýt poslední pole nebo chybu. U dokumentu může být vlastní
   scroll náhledu; nevyžadovat současné posouvání tří vnořených kontejnerů.
9. **I-R09 — Stav operace.** Navrhnout validaci, odesílání, chybu i úspěch, pokud je prvek má.
   Při chybě zachovat hodnoty a umožnit existující opakování. Žádný falešný úspěch, nové
   časovače ani umělé čekání. Opakovaným kliknutím nesmí mockup simulovat dvojí operaci.
10. **I-R10 — Dotyk a zoom.** Cíle alespoň 44 × 44 px na dotykových zařízeních.
    Tooltip musí mít dostupnou informaci i při fokusu či dotyku, podle typu prvku.
    Ověřit větší text a zoom 200 % s přeskupením; nesnižovat text jen pro zachování mřížky.
11. **I-R11 — Zpětná vazba.** Toast nepřebírá fokus. Zachovat současné varianty success/info/error:
    úspěch mizí po 5 s, informace po 6 s, chyba až po zavření. Detaily chyb jsou čitelné
    a kopírovatelné. Toast nesmí skrýt primární akci nebo tlačítko zavření jiného okna.
12. **I-R12 — Stav po návratu.** Zavření bez potvrzení nemění data. Rozdíl mezi rozpracovanou
    a použitou hodnotou filtru zachovat podle existujícího toku. Po otočení, resize nebo
    návratu do pole zůstává rozpracovaný formulář zachovaný, pokud dnešní tok neurčuje jinak.

## Povinné stavy

| Prvek | Minimální sada scén |
| --- | --- |
| Potvrzení / formulář | otevřeno, zrušení, validace, probíhající operace, chyba, úspěch; disabled dle oprávnění |
| Menu / select | zavřeno, otevřeno, aktuální volba, fokus, disabled, dlouhá položka, poslední řádek tabulky |
| Našeptávač | prázdný dotaz, načítání, více výsledků, žádný výsledek, chyba, výběr klávesnicí |
| Filtry / období | výchozí, aktivní, rozpracované změny, použití, reset a zrušení podle existujících akcí |
| Tooltip | hover, fokus/dotyk, zavření Escape, levý/pravý/dolní okraj |
| Oznámení | načítání, prázdné, nepřečtené, dlouhý seznam, chyba načtení a chyba akce |
| Accordion | zavřeno, otevřeno, dlouhý obsah, více současně otevřených sekcí dle současného chování |
| Toast | success, info, error, dlouhý text/detail, více oznámení, ruční zavření |
| PDF / panel | načítání či chyba pokud existuje, dlouhý dokument/obsah, dostupné zavření, malá výška |

Scénáře, které konkrétní prvek nemá, označit N/A s důvodem. Nevymýšlet nové stavy backendu.
Chybové a načítací scénáře v HTML jsou výslovně **simulované stavy mockupu**, ne živé operace.
Nativní select a datumový picker se mohou lišit podle systému; jejich otevřenou podobu
ověřit v prohlížeči, ne nahrazovat vlastním widgetem kvůli shodě screenshotu.

## Velikosti a pořadí

1. Zachytit otevřené reference mobil 390 × 844 a MacBook 1470 × 830.
2. Navrhnout 1024 × 768 a 2560 × 1440, poté 1180 × 820, 1366 × 768 a 1920 × 1080.
3. Ověřit 320 × 568, 768 × 1024, 1024 × 600 (malá výška), mezilehlé šířky a 3840 × 2160.
4. U polí a formulářových oken ověřit otevřenou softwarovou klávesnici na mobilu,
   rotaci a větší text. Emulace desktopového viewportu sama neprokazuje chování klávesnice.

Nejprve I04/I05/I06/I07 (nejčastější ovládání), pak I01/I02/I03, následně ostatní rodiny.
Sdílenou komponentu navrhnout jednou, ale ověřit ji v každém odlišném kontextu:
např. nabídka nahoře, nabídka v posledním řádku, nabídka uvnitř dialogu.

## Formát scén

Jeden HTML soubor na **stránku + prvek + stav + velikost**:
`invoices-row-actions-open-bottom-1024x768.html` nebo
`invoice-create-customer-dialog-validation-2560x1440.html`.
Odevzdat plný kontext stránky, funkční lokální otevření/zavření a potřebné ovládání.
Síťová volání ani skutečné odesílání, mazání, platby či ukládání do aplikace nejsou součástí mockupu.

Ke scéně přiložit: ID rodiny a varianty z registru, spouštěč, původní a změněné chování,
pravidla I-Rxx, naměřené rozměry, screenshot a stav každé kontroly PASS/FAIL/N/A/NEOVĚŘENO.
Statický obrázek sám neprokazuje klávesnici ani fokus. Neověřenou kontrolu neoznačovat PASS.

## Prompt pro ChatGPT

```text
Přečti README a dokumenty 01–06 z přiloženého balíčku Splatno.
Vytvoř interaktivní HTML mockup stránky: <stránka>.
Prvek / varianta: <ID z 06_INTERACTION_INVENTORY.md>.
Stav: <např. otevřené menu v posledním řádku / chyba formuláře>.
Viewport: <šířka × výška>.
Použij podklad pilíře a pouze vzorová data. Zachovej existující funkce a mobil/MacBook.
Dodej samostatný HTML soubor s celým kontextem stránky, screenshot, stručný popis změn
s pravidly I-Rxx a vyplněnou kontrolu z 04 a 05. Stav simulovaných operací jasně označ.
Chybějící referenci nebo neprovedený test uveď výslovně. Nic neoznačuj jako schválené.
```

## Kontrolní seznam otevřených prvků

- [ ] Celý prvek i všechny akce jsou uvnitř viditelného viewportu, včetně safe-area.
- [ ] U horního, pravého i dolního okraje se poloha správně přizpůsobí.
- [ ] Prvek neořezává tabulka, karta, sticky panel ani nadřazený dialog.
- [ ] Scroll seznamu nevyvolává zavření při běžném procházení možností.
- [ ] Resize, scroll stránky, rotace a klávesnice ponechají ovládání dostupné.
- [ ] Otevření, výběr, zavření a návrat fokusu fungují klávesnicí.
- [ ] Modalita, Escape, kliknutí mimo a blokování zavření odpovídají konkrétnímu toku.
- [ ] Je čitelné označení prvku, aktuální volba, fokus, chyba a disabled stav.
- [ ] Dlouhé hodnoty a úplná čísla nejsou uříznuté; cíle mají potřebnou velikost.
- [ ] Patička nepřekrývá pole a obsah při malém okně nebo větším textu.
- [ ] Zrušení a chyba zachovají správný stav; mockup neprovádí skutečné operace.
- [ ] Toast a ostatní souběžné vrstvy nezakrývají potřebné ovládání.
- [ ] Existují reference otevřených pilířů, nebo je jejich absence přiznaná.
- [ ] Každá kontrola uvádí, zda je vizuální, automatická, ruční nebo neprovedená.

Automatický skript pro stránku v dokumentu 04 nepokrývá portály, top layer,
klávesnici, fokus, nativní pickery ani dotyk. Nelze ho použít jako jediný důkaz.
