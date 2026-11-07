# Pravidla přechodů responzivity — návrh v1.1

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
5. **Navigace podle obrazovky.**
   - < 768: dnešní mobilní hlavička a menu.
   - 768–1099: rail 84 px (ikona a krátký popisek).
   - 1100–1599: sidebar 220–244 px.
   - ≥ 1600: sidebar 264 px.

   Ve vyšším okně rostou řádky menu i jejich text, takže menu zaplní výšku. Profil je vždy u spodního
   okraje a mezi menu a profilem nezůstane díra.
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
