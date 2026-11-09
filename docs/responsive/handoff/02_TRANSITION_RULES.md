# Pravidla přechodů responzivity — v1.5

Stav: pravidla jsou implementovaná na větvi `responsive/extended` na všech pracovních stránkách
(navigace, konec lupy, horní lišta, hlavičky stránek, Nástěnka, Faktury, Archiv faktur, Detail
faktury, Tvorba a Ruční faktura, Import včetně kontroly OCR, Platby včetně párování, Archiv plateb,
Upomínky, Zákazníci, Reporty, Oznámení, Nastavení, Předplatné a otevírací vrstvy). Vznikla z mockupů (Figma „Splatno —
responzivní mockupy“, https://www.figma.com/design/YK83a6K9WYjLnAQ3md1HYS). Kde se implementace
na pokyn uživatele odchýlila od návrhu, platí text níže; přehled je v sekci „Rozhodnutí během
implementace“ na konci.

## Pilíře

| Pilíř   | Viewport                         | Pravidlo                         |
| ------- | -------------------------------- | -------------------------------- |
| Mobil   | 320–639 px (ověřeno 342 a 390)   | Zůstává přesně jako dnes         |
| MacBook | ≈ 1470 × 830 (MacBook Air 13")   | Zůstává jako dnes, kromě výjimek níže |

Každé pravidlo níže musí v pilířích dát dnešní výsledek. Mění se jen velikosti mezi nimi a nad nimi.
Na MacBooku jsou schválené jen tyto změny (uživatel je výslovně požadoval):
- horní lišta je o 20 px níž a logo s ní na jedné ose (pravidlo 16),
- zelené panely Importu a Plateb mají jeden společný sloupec pro nadpis a body (pravidlo 13).

Hlídá to `scripts/responsive-mockups/pillar-guard.mjs` (15 stránek × 342, 390, 1470 × 830,
porovnání po pixelech). Po schválené změně se referenční snímky pořídí znovu.

## Pravidla

1. **Pilíře se nemění.** Viz výše.
2. **Statický viewport je výchozí.** Pracovní obrazovka (seznam, nástěnka, upload) se vejde do okna
   a jako celek se neposouvá. Poslední panel vyplní zbytek výšky až ke spodnímu okraji, takže dole
   nezůstane mezera.
3. **Scroll jen když to vyžaduje obsah.** Pořadí řešení: (a) kompaktnější varianta komponenty,
   (b) stránkování podle výšky, (c) vnitřní scroll panelu s přilepeným záhlavím a akcemi.
   Celá stránka se posouvá jen u obsahu s přirozenou délkou (tvorba faktury, nastavení).
4. **Počet řádků podle výšky.** Seznam počítá řádky na stránku z dostupné výšky, nikdy ne půl řádku.
   Zbytek pod posledním řádkem se rozpočítá do výšky řádků (max +18 px na řádek, půl nahoru, půl dolů).
   Seznam faktur to nabízí jako volbu **„Automaticky“** (5–100 řádků, měřeno od záhlaví tabulky ke
   stránkování; po změně okna zůstane na obrazovce faktura, která byla nahoře). **Výchozí volba zůstává
   25 na stránku**, takže se pilíř nemění, dokud si „Automaticky“ uživatel nevybere. Ruční velikosti
   (10/25/50/100) nechávají stránku posouvat jako dosud, ne vnitřní scroll panelu.
5. **Navigace podle obrazovky — na velkém displeji nesmí být malá ani prázdná.**

   | Okno       | Navigace      | Text / ikona | Logo / Esko / avatar | Podsekce                       |
   | ---------- | ------------- | ------------ | -------------------- | ------------------------------ |
   | < 1024     | mobilní hlavička + vysouvací menu (beze změny) | — | — | —                 |
   | 1024–1099  | rail 84 px    | 10 / 20 px   | značka 30 / 40 / 40  | aktivní oddíl (popisky se zalomí) |
   | 1100–1599  | sidebar 220–244 px | 14 / 20 px | 28 / 28 / 42       | aktivní oddíl                  |
   | 1600–2199  | sidebar 280 px | 18 / 22 px  | 30 / 60 / 46         | aktivní oddíl                  |
   | ≥ 2200     | sidebar 320 px | 21 / 26 px  | 36 / 84 / 54         | aktivní oddíl                  |

   - Rail začíná až od 1024 px: pod touto šířkou mají stránky mobilní rozložení a rail k nim nepasuje.
   - Rozbalený je **jen aktivní oddíl** na každé velikosti. Rozbalené zavřené oddíly na vysokých oknech
     vypadaly jako otevřené a nebylo poznat, kde uživatel je (zrušeno na jeho pokyn).
   - Střed loga leží na stejné ose jako střed horní lišty; mezera pod logem se zmenší o stejný kus,
     o který logo kleslo, takže menu zůstává na místě.
   - Řádky hlavních položek rostou s výškou okna (max +28 px; u 320 px až od výšky 1100 px) a jsou
     **pohromadě nahoře**, Nastavení hned za oddělovačem. Zbylá výška zůstane pod menu nad Eskem
     (uživatel dal přednost tomu před rozprostřením menu po celé výšce).
   - Pod menu je Esko a profil, vždy u spodního okraje. Menu se nikdy neposouvá (ověřeno 1024 × 768 až 3440 × 1440).
6. **Velké obrazovky: text roste s objektem, ne lupou.** Celé UI se nezvětšuje lupou (dnes 1,11× a
   1,22×). Místo navíc dostanou nejdřív další sloupce, víc řádků a panel detailu. Text roste se svým
   objektem v pevných mezích:

   | Role                | MacBook | Maximum |
   | ------------------- | ------- | ------- |
   | Buňka tabulky       | 13 px   | 15 px   |
   | Částka, číslo       | 14 px   | 16 px   |
   | Položka menu        | 15 px   | 18 px   |
   | Hodnota KPI         | 36 px   | 56 px   |
   | Ikona KPI           | 40 px   | 68 px   |
   | Nadpis stránky      | 42 px   | 48 px   |

7. **Text se zkrátí, zalomí nebo přeskupí, ale nikdy nepřeteče.**
   - Jména, e-maily a popisy: jeden řádek, tři tečky, celý text v tooltipu.
   - Nadpisy: zalomit nejvýš na 2 řádky, pak zmenšit krokem (42 → 32 → 28).
   - Tlačítka: plný popisek → krátký → jen ikona s tooltipem.
8. **Čísla a částky se nezkracují.** Částky, čísla faktur, VS a data nikdy nedostanou tři tečky ani
   ořez. Sloupec má šířku podle nejdelší hodnoty. Když se nevejde: přesun na 2. řádek buňky, pak
   menší řez písma, minimum 12 px. Tabulární číslice.
9. **Ikony, štítky a ovládací prvky drží tvar.** Ikony 16–20 px se neškálují s textem tabulky (výjimka:
   navigace a akce podle pravidla 6). Štítky stavu se nezalamují. Když se nevejdou, nahradí je barevná
   tečka s tooltipem. Dotykové cíle na tabletu mají aspoň 44 × 44 px, ale **zvětšuje se jen neviditelná
   plocha pro dotyk, nikdy kreslený prvek**: switch zůstane podlouhlý, checkbox a radio čtvercové, ikona
   v původním poměru stran. Hlídá `scripts/responsive-mockups/control-shape-check.mjs` (myš i dotyk,
   390–2560 px).
10. **Kdo rozhoduje o změně.**
    - Shell (navigace) reaguje na viewport.
    - Rodina stránky (seznam, formulář, upload, dokument) reaguje na výšku a šířku plátna.
    - Komponenta (tabulka, KPI, filtry) reaguje jen na šířku svého kontejneru (`@container`).

    Žádné globální přepisy cizích komponent.
11. **Větší objekt má větší text, ne prázdnou plochu.** Když se objekt zvětší kvůli vyplnění výšky
    nebo šířky, roste s ním text i ikony (`font-size: clamp(min, % kontejneru, max)`). Pořadí:
    1. víc obsahu (řádky, sloupce, sekce detailu),
    2. větší text a ikony do maxima role,
    3. teprve potom vnitřní mezery.

    Prázdná plocha uvnitř karty nesmí být větší než jeden její řádek obsahu. Když se obsah
    nevejde ani do nejmenší varianty, přeskupí se (např. donut v úzké kartě skryje procenta).
12. **Centrování drží při každé transformaci.** Text je svisle vystředěný v řádku, tlačítku, štítku i
    položce menu podle skutečné výšky písma. Když objekt roste, padding roste symetricky, takže střed
    zůstává. Samostatné bloky (prázdný stav, upload, hodnota KPI) jsou vystředěné v ose objektu i po
    zalomení textu. Čísla ve sloupci mají stejnou hranu zarovnání.

13. **Logické umístění a zarovnání.**
    - Sloupec je ve všech řádcích i v záhlaví na stejném místě (odchylka 0 px). Tabulky proto používají pevné nebo poměrové šířky sloupců, nikdy `auto`, které si každý řádek počítá sám.
    - Textové sloupce jsou zarovnané vlevo. Částky, počty a data, která se porovnávají, jsou vpravo, s tabulárními číslicemi. Záhlaví má stejné zarovnání jako jeho sloupec.
    - Karty v jedné řadě mají stejnou horní i spodní hranu a stejný vnitřní padding. Nadpisy sousedních karet leží na stejné výšce.
    - Ikona je svisle vystředěná s prvním řádkem textu (odchylka ≤ 1 px). Tlačítka v jedné řadě mají stejnou výšku.
    - Nadpis s ikonou a seznam pod ním sdílí jeden sloupec: ikony (čísla) položek jsou vystředěné pod ikonou nadpisu a text položek začíná přesně tam, kde text nadpisu (zelené panely Importu a Plateb, odchylka 0 px).
    - Levá hrana obsahu stránky (hlavička, karty, tabulka) je jedna svislá linie.
    - Dvojice popisek–hodnota (detail, souhrn) jsou ve dvou sloupcích se společnou hranou.
    - Obsah, který je na široké kartě výrazně užší než karta (KPI), se vycentruje jako blok. Na úzké kartě zůstává vlevo.
14. **Nezapomínat na prvky mimo obsah.** Každý mockup i implementace má vrstvy, které nejsou v datech:
    - pozadí aplikace (základ `#f9fbf9`, mátový gradient vpravo nahoře, zelené vlny vlevo dole; pevná vrstva za vším, navigace je poloprůhledná),
    - logo Splatno (značka + slovo), Esko v navigaci, avatar s obrysem, oddělovače,
    - stavové prvky lišty (tečka nepřečtených oznámení), stíny a okraje karet.

    Plochá barva místo pozadí nebo čtverec místo loga je chyba.

15. **Objekty se zvětšují stejně jako zmenšují — žádné velké mezery.**
    - Škálovatelný objekt (donut, graf, KPI, náhled dokumentu, ilustrace) roste i se zmenšuje s menším z rozměrů své karty. Spolu s ním roste text, ikony a vnitřní mezery (`clamp()` s `cqi` / `cqh`). Spodní hranicí je tabletová velikost, horní strop role.
    - Obsah zabírá aspoň **75 %** omezující osy karty. Největší prázdný okraj je nejvýš **max(40 px, 15 % rozměru)**. Měří `scripts/responsive-mockups/html/fill.mjs`.
    - Když krátký obsah nevyplní šířku ani v maximální velikosti, **rozloží se** (např. KPI: název a hodnota vlevo, částka zarovnaná k pravému okraji). Nepřidává se nový obsah a nenechává se prázdný okraj.
    - Naměřeno na Nástěnce 2560 (před → po): donut největší okraj 115 → 61 px, KPI 142 → 1 px.
    - Panel, jehož výška vychází z vyplnění okna, smí být `container-type: size` a jeho obsah se pak řídí kratší stranou (`cqmin`). Vlastní `padding` a `gap` kontejneru se ale počítají z nadřazeného kontejneru, proto se odvozují od okna (`vmin`) a mezery mezi položkami jsou jejich okraje.

16. **Horní lišta (hledání, Importovat fakturu, Nová faktura, oznámení).**
    - Na každé desktopové velikosti (od 1024 px) je o 20 px níž než původně, a to relativním posunem: pohne se jen lišta, mezera pod ní se zmenší a obsah stránky zůstane na místě.
    - Výjimka: hustá mřížka Nástěnky na oknech do výšky 899 px má pod lištou jen 18–28 px, tam je posun 8 px (logo je proto o 12 px pod osou lišty).
    - Od MacBooku (1470 px) do 2560 px roste lineárně: ovládací prvky 44 → 56 px, text hledání 12 → 15 px, tlačítka 13 → 16 px, ikony 19 → 24 px, pole hledání 438 → 600 px. Pod 1470 px a nad 2560 px se nemění.
    - **Mezera mezi lištou a hlavičkou stránky je na všech stránkách stejná** (`--page-head-gap`): 40 px na MacBooku, lineárně 48 px na 2560, na nízkých oknech (výška ≤ 800 px) 32 px. Hlavičky stránek na desktopu nemají vlastní horní okraj a úlohové stránky (Import) se pod lištou nevystřeďují. Výjimka: Nástěnka si mezery dopočítává sama, aby se vešla bez posouvání. Rozhodnutí uživatele 8. 11. (dřív měla většina stránek jen 12 px).

17. **Růst nad MacBookem bez lupy celé stránky.** Tři sdílené proměnné, každá na jiné úrovni:
    - `--workspace-grow` (`main.content`): 0 px do 1600, pak lineárně až 960 px. Z ní rostou
      rozměry rodin stránek (sloupce, výšky).
    - `--header-zoom` (1 / 1,04 / 1,08 / 1,11 / 1,14 při 1600 / 1920 / 2200 / 2560): hlavičky stránek
      a obsah sekcí. Zoom se dává **pod** natahovací kontejnery (`section > *`), protože zoomovaná
      flex položka nedostane celý svůj podíl volného místa.
    - `--ui-zoom` (1 / 1,06 / 1,1 / 1,13 / 1,16): otevírací vrstvy (`[data-popup] > *`, modální
      dialogy). Dialog uvnitř zoomované hlavičky dostane `zoom: calc(ui / header)`, jinak by se
      zoom násobil. Výška dialogu je omezená `calc((100dvh − 24px) / --ui-zoom)`.

    Pod 1600 px jsou všechny tři neutrální, takže pilíř 1470 se nemění.

## Faktury — aplikace pravidel

Implementováno takto (počet řádků platí pro volbu „Automaticky“):

| Viewport    | Navigace     | Hlavička                  | Filtry                           | Sloupce                                                                       | Řádků/stránku |
| ----------- | ------------ | ------------------------- | -------------------------------- | ----------------------------------------------------------------------------- | ------------- |
| 1024 × 768  | rail 84      | kompaktní (32 px)         | 1 řada, data pod „Datum a další“ | Faktura, Odběratel, Částka, Splatnost, Stav (+ pruh úhrady), akce             | 5             |
| 1180 × 820  | sidebar 220  | kompaktní (32 px)         | 1 řada, data pod „Datum a další“ | stejné jako 1024                                                              | 5             |
| 1366 × 768  | sidebar 244  | kompaktní (nízké okno)    | 1 řada, data pod „Datum a další“ | stejné jako 1024                                                              | 5             |
| 1470 × 830  | sidebar 244  | plná (pilíř)              | pilíř                            | pilíř (+ Uhrazeno)                                                            | 5             |
| 1920 × 1080 | sidebar 280  | plná                      | 1 řada se všemi poli             | + Vystaveno, Uhrazeno, Upomínky; text buněk 14,7 px                           | 8             |
| 2560 × 1440 | sidebar 320  | plná                      | 1 řada se všemi poli             | jako 1920; text 16 px; panel detailu 400 px                                   | 13            |

- Kompakt platí, když je panel záznamů užší než 1090 px (komponentní `@container`, ne viewport).
- Sloupce Vystaveno a Upomínky se ukážou od šířky panelu 1400 px; buňky existují vždy, jen bez šířky.
- Panel detailu od šířky okna 2200 px: klik na řádek vybírá do panelu (pod 2200 px otevírá detail).
  V panelu jsou jen existující akce („Potvrdit úhradu“ se stejným potvrzením, „Otevřít detail“);
  upomínky se z panelu neposílají.
- Řádků je méně než v mockupu (6/7/9/14), protože hlavička a filtry v aplikaci zabírají víc výšky.
- Ověřují `auto-rows-check.mjs`, `detail-pane-check.mjs` a `invoices-design-check.mjs`.

## Ostatní stránky — aplikace pravidel

| Stránka (rodina) | Tablet 1024–1279 | Velká okna ≥ 1600 |
| ---------------- | ---------------- | ----------------- |
| Nástěnka (overview) | hustá mřížka od 1024, kompaktní řádky odběratelů | KPI a ikony rostou do maxima role; donut je `size` kontejner (`--d: clamp(96px, min(92cqh, 40cqi), 420px)`) a s ním text legendy; prázdné upomínky vystředěné v kartě |
| Tvorba faktury (form) | dva sloupce, náhled pod 380 px skryje popisek „Šablona“ | pole ve 3 sloupcích od šířky kontejneru 800 px, pole a text rostou |
| Detail faktury (document) | beze změny rozložení | sloupec se natáhne do výšky okna, historie vyplní zbytek, prázdné stavy vystředěné |
| Import, Platby (task / document) | sdílený sloupec v zelených panelech | obsah roste s plochou (`size` kontejner); nízká okna ≤ 740 px kompaktní |
| Kontrola OCR (document) | — | náhled dokumentu začíná u každého nového dokladu na 1. straně |
| Zákazníci, Archiv plateb, Oznámení (collection) | kompaktní filtry | poslední panel vyplní výšku, sekce rostou s `--header-zoom` |
| Upomínky, Reporty, Nastavení, Předplatné | beze změny | sekce rostou s `--header-zoom`; stránky s přirozenou délkou se posouvají |

Na 1024–1279 × ≤ 768 se task stránky posouvají až o ~120 px (přijato: kompaktnější varianta by
schovala povinné kroky). Na 4K narážejí stránky na horní stropy růstu a pod obsahem zůstane volno;
to je záměr (pravidlo 6: text roste jen do maxima role).

## Veřejné stránky a Onboarding

| Stránka | Tablet a nízká okna | Velká okna |
| ------- | ------------------- | ---------- |
| Přihlášení, Obnova a Nové heslo, MFA, Registrace | beze změny (vejdou se) | od 2200 × 1240 roste celá karta i s textem (1,1×, od 2560 1,16×) |
| Pozvánka do firmy | na desktopu s výškou ≤ 900 px kompaktní (pole 44 px, tlačítko 48 px, menší nadpis a logo), ≤ 800 px i užší okraje; tlačítko „Vstoupit do firmy“ je vždy v okně | jako přihlášení |
| Onboarding | kroky vlevo od 1180 px aspoň 304 px, popisy na jeden řádek | od 2200 × 1240 roste karta (1,1× / 1,16×) |
| Podmínky, Ochrana osobních údajů | beze změny | od 1920 px roste celý článek (1,1×, od 2560 1,2×); délka řádku zůstává ~75 znaků |

Na 4K zůstávají veřejné stránky ve velikosti 2560 jako zbytek aplikace. Pilíře hlídá
`pillar-guard.mjs` i pro tyto stránky (25 stránek × 3 velikosti).

## Otevřené vrstvy a sbalitelné sekce

Pro interaktivní prvky platí doplněk `05_INTERACTIVE_STATES.md` (I-R01 až I-R12). Implementováno:
Escape zavře nejvnitřnější otevřenou nabídku a vrátí fokus na její spouštěč (`PopupFitter`);
dialog vrací fokus otevírači, nebo spouštěči nabídky, která se mezitím zavřela (`focusReturnTarget`);
na dotykových zařízeních (`pointer: coarse`) mají ovládací prvky vrstev aspoň 44 px; telefon se
pozná podle kratší strany < 600 px, tablety (od 7") smí na šířku. Ověřuje `overlay-check.mjs`.
Pravidla 2 a 11 řeší plátno stránky a jeho panely; krátké dialogy, menu, tooltipy
a prázdné stavy mají přirozenou velikost, nemusí vyplnit viewport ani přidávat obsah.
Mobil a MacBook nejprve porovnat s otevřenými referencemi, které zatím v balíčku chybí.

## Rozhodnutí během implementace

| Téma | Návrh v1.3 | Platí (v1.4) | Proč |
| ---- | ---------- | ------------ | ---- |
| Rail | 768–1099 px | 1024–1099 px | pod 1024 mají stránky mobilní rozložení |
| Podsekce v navigaci | na vysokých oknech i zavřené oddíly | jen aktivní oddíl | zavřené vypadaly jako otevřené (uživatel) |
| Výška navigace | řádky +28 px, díra ≤ 50 px | řádky +28 px pohromadě nahoře, zbytek nad Eskem | uživatel nechtěl menu rozprostřené |
| „Automaticky“ | výchozí volba | volba, výchozí 25 | pilíř beze změny, rozhodne uživatel |
| Ruční velikost stránky | vnitřní scroll panelu | stránka se posouvá jako dosud | beze změny chování |
| Horní lišta | — | o 20 px níž, roste 1470 → 2560 | požadavek uživatele (pravidlo 16) |
| Lupa nad 1600 px | zrušit | zrušena | skutečné velikosti místo zoomu |
| Zelené panely | text roste se šířkou | obsah roste s plochou, sdílený sloupec | uživatel: víc vyplnit, lépe zarovnat |
| Datum ve formulářích | — | pole nepřetéká, min. šířka 281 px | uživatel: data přetékala |
| Donut na Nástěnce | pevná velikost | roste s kratší stranou karty | uživatel: nesedělo k textům |
| Prázdné upomínky | vpravo nahoře | uprostřed karty | uživatel |
| Hlavičky stránek | nadpis 42 → 48 px | celá hlavička `--header-zoom` (max 1,14) | jednotný růst s lištou |

Pojistka proti nahodilým breakpointům: `scripts/responsive-lint.mjs` (součást `npm run lint`)
spočítá `@media` hodnoty mimo dohodnutou sadu po souborech; počet smí jen klesat.

Oznámení pod 1600 px zůstávají s kartou podle obsahu (pod ní 300–420 px pozadí); roztažená karta
by při pár oznámeních měla prázdnotu uvnitř a změnila by pilíř 1470. Uživatel 8. 11. potvrdil:
nechat, jak je. Známý otevřený bod: Nástěnka 1600 × 900 se posouvá o 2 px.
