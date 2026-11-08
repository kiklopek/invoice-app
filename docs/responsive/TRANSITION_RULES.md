# Pravidla přechodů responzivity — v1.4

Stav: pravidla se implementují na větvi `responsive/extended` (hotovo: navigace, konec lupy,
Faktury, Archiv faktur, Import a Platby, horní lišta). Vznikla z mockupů (Figma „Splatno —
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
9. **Ikony a štítky drží tvar.** Ikony 16–20 px se neškálují s textem tabulky (výjimka: navigace a
   akce podle pravidla 6). Štítky stavu se nezalamují. Když se nevejdou, nahradí je barevná tečka s
   tooltipem. Dotykové cíle na tabletu mají aspoň 44 × 44 px.
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

## Faktury — aplikace pravidel

| Viewport    | Navigace     | Hlavička                  | Filtry                           | Sloupce                                                                       | Řádků/stránku |
| ----------- | ------------ | ------------------------- | -------------------------------- | ----------------------------------------------------------------------------- | ------------- |
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

## Otevřené vrstvy a sbalitelné sekce

Pro interaktivní prvky platí doplněk `05_INTERACTIVE_STATES.md` (I-R01 až I-R12).
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

Známé otevřené body: Import a Platby na 1280 × 720 přetékají o 20 px (stav i před změnami);
Zákazníci, Archiv plateb, Upomínky, Reporty, Předplatné a Oznámení ještě nevyplňují velká okna.
