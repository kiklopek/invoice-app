# Pravidla přechodů responzivity — návrh v1.2

Stav: návrh odvozený z mockupů stránky Faktury (Figma „Splatno — responzivní mockupy“,
https://www.figma.com/design/YK83a6K9WYjLnAQ3md1HYS). Čeká na schválení. Konkrétní prahy
pro ostatní stránky se doplní po jejich mockupech. Kód aplikace se podle toho zatím nemění.

## Pilíře

| Pilíř   | Viewport                         | Pravidlo                         |
| ------- | -------------------------------- | -------------------------------- |
| Mobil   | 320–639 px (ověřeno 342 a 390)   | Zůstává přesně jako dnes         |
| MacBook | ≈ 1470 × 830 (MacBook Air 13")   | Zůstává přesně jako dnes         |

Každé pravidlo níže musí v pilířích dát dnešní výsledek. Mění se jen velikosti mezi nimi a nad nimi.

## Pravidla

1. **Pilíře se nemění.** Viz výše.
2. **Statický viewport je výchozí.** Pracovní obrazovka (seznam, nástěnka, upload) se vejde do okna
   a jako celek se neposouvá. Poslední panel vyplní zbytek výšky až ke spodnímu okraji, takže dole
   nezůstane mezera.
3. **Scroll jen když to vyžaduje obsah.** Pořadí řešení: (a) kompaktnější varianta komponenty,
   (b) stránkování podle výšky, (c) vnitřní scroll panelu s přilepeným záhlavím a akcemi.
   Celá stránka se posouvá jen u obsahu s přirozenou délkou (tvorba faktury, nastavení).
4. **Počet řádků podle výšky.** Seznam počítá řádky na stránku z dostupné výšky, nikdy ne půl řádku.
   Zbytek pod posledním řádkem se rozpočítá do výšky řádků (max +18 px na řádek, půl nahoru, půl dolů). Výchozí volba je
   „Automaticky“. Ruční 10/25/50 přepne panel na vnitřní scroll.
5. **Navigace podle obrazovky — na velkém displeji nesmí být malá ani prázdná.**

   | Okno       | Navigace      | Text / ikona | Logo / Esko / avatar | Podsekce                       |
   | ---------- | ------------- | ------------ | -------------------- | ------------------------------ |
   | < 768      | mobilní hlavička + vysouvací menu (beze změny) | — | — | —                 |
   | 768–1099   | rail 84 px    | 10 / 20 px   | značka 30 / 40 / 40  | jen v menu po rozbalení        |
   | 1100–1599  | sidebar 220–244 px | 15 / 18 px | 26 / 44 / 40       | jen aktivní oddíl              |
   | 1600–2199  | sidebar 280 px | 18 / 22 px  | 30 / 60 / 46         | aktivní oddíl + Faktury        |
   | ≥ 2200     | sidebar 320 px | 21 / 26 px  | 36 / 84 / 54         | všechny oddíly (od výšky 1300) |

   - Střed loga leží na stejné ose jako střed horní lišty.
   - Pod menu je Esko a profil, vždy u spodního okraje.
   - Zbylá výška se rozpočítá do řádků hlavních položek (max +28 px na řádek), podsekce zůstávají kompaktní. Díra mezi menu a Eskem je nejvýš ~50 px.
   - Podsekce na vysokých oknech jsou existující stránky (žádná nová místa), jen dostupné bez rozbalování.
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
    - Levá hrana obsahu stránky (hlavička, karty, tabulka) je jedna svislá linie.
    - Dvojice popisek–hodnota (detail, souhrn) jsou ve dvou sloupcích se společnou hranou.
    - Obsah, který je na široké kartě výrazně užší než karta (KPI), se vycentruje jako blok. Na úzké kartě zůstává vlevo.
14. **Nezapomínat na prvky mimo obsah.** Každý mockup i implementace má vrstvy, které nejsou v datech:
    - pozadí aplikace (základ `#f9fbf9`, mátový gradient vpravo nahoře, zelené vlny vlevo dole; pevná vrstva za vším, navigace je poloprůhledná),
    - logo Splatno (značka + slovo), Esko v navigaci, avatar s obrysem, oddělovače,
    - stavové prvky lišty (tečka nepřečtených oznámení), stíny a okraje karet.

    Plochá barva místo pozadí nebo čtverec místo loga je chyba.

## Faktury — aplikace pravidel

| Viewport    | Navigace     | Hlavička                  | Filtry                           | Sloupce                                                                       | Řádků/stránku |
| ----------- | ------------ | ------------------------- | -------------------------------- | ----------------------------------------------------------------------------- | ------------- |
| 1024 × 768  | rail 84      | kompaktní (32 px)         | 1 řada, data v popoveru          | Faktura, Odběratel, Částka, Splatnost, Stav (+ pruh úhrady)                   | 6             |
| 1180 × 820  | sidebar 220  | kompaktní (32 px)         | 1 řada, data v popoveru          | stejné jako 1024 (obsah je stejně široký)                                     | 7             |
| 1920 × 1080 | sidebar 264  | plná (45 px)              | 1 řada se všemi poli             | + Vystaveno, Uhrazeno, Upomínky; text +1 px                                   | 9             |
| 2560 × 1440 | sidebar 264  | plná (48 px)              | 1 řada se všemi poli             | jako 1920; text +2 px; panel detailu 400 px na plnou výšku                    | 14            |

Ověřeno v mockupu: žádný rám nepřesahuje okno. Mezera pod posledním řádkem je ≤ 25 px, mezi menu a
profilem 33–41 px, v panelu detailu 22 px.

## Otevřené vrstvy a sbalitelné sekce

Pro interaktivní prvky platí doplněk `05_INTERACTIVE_STATES.md` (I-R01 až I-R12).
Pravidla 2 a 11 řeší plátno stránky a jeho panely; krátké dialogy, menu, tooltipy
a prázdné stavy mají přirozenou velikost, nemusí vyplnit viewport ani přidávat obsah.
Mobil a MacBook nejprve porovnat s otevřenými referencemi, které zatím v balíčku chybí.
