# Splatno — balíček pro generování responzivních mockupů

Tento balíček slouží jinému AI modelu (např. ChatGPT) k samostatnému generování mockupů
jednotlivých obrazovek aplikace **Splatno** (česká SaaS aplikace pro fakturaci a vymáhání
pohledávek) v různých velikostech okna. Obsahuje všechno potřebné: vzhled, komponenty,
pravidla přechodů mezi velikostmi, specifikace stránek, referenční obrázky a šablonu promptu.

## Rozšíření: popupy a další interaktivní prvky

Balíček zahrnuje také otevřené stavy dialogů, menu, selectů, našeptávačů, filtrů,
tooltipů, oznámení, toastů, vysouvacích panelů a sbalitelných sekcí.
`05_INTERACTIVE_STATES.md` stanovuje jejich chování, rozměry, scénáře a vlastní prompt.
`06_INTERACTION_INVENTORY.md` mapuje konkrétní varianty všech 15 pracovních stránek
na zdroje aplikace. Jde o zadání dalších mockupů; reference otevřených stavů zatím nejsou dodané.

## Co je cílem

Aplikace má dva **hotové a schválené pilíře**, které se nesmí měnit:

| Pilíř   | Okno (CSS px)                  | Obrázky                                  |
| ------- | ------------------------------ | ---------------------------------------- |
| Mobil   | 320–639 px, reference 390 × 844 | `reference/pillars/*--mobil-390.png`     |
| MacBook | 1470 × 830 (MacBook Air 13")   | `reference/pillars/*--macbook-1470x830.png` |

Úkolem je navrhnout, jak má stránka vypadat **mezi pilíři a nad nimi**:

| Velikost     | Zařízení                         |
| ------------ | -------------------------------- |
| 1024 × 768   | tablet na šířku, malý notebook   |
| 1180 × 820   | iPad Air na šířku                |
| 1366 × 768   | levný notebook s Windows         |
| 1920 × 1080  | klasický desktop                 |
| 2560 × 1440  | 27" monitor                      |
| 3840 × 2160  | 4K (jen ověření)                 |

## Pořadí čtení

1. `01_DESIGN_SYSTEM.md`: barvy, písmo, mezery, komponenty a jejich velikosti.
2. `02_TRANSITION_RULES.md`: 14 závazných pravidel, jak se layout mění s velikostí. **Nejdůležitější soubor.**
3. `03_PAGE_SPECS.md`: co je na každé stránce a jak se má chovat v každé velikosti.
4. `04_OUTPUT_AND_CHECKLIST.md`: v jakém formátu odevzdat a jak výsledek zkontrolovat.
5. `05_INTERACTIVE_STATES.md` a `06_INTERACTION_INVENTORY.md`: otevřené prvky, stavy a pokrytí.
6. `assets/base.css` a `assets/icons.js`: hotové CSS a ikony, které se mají použít.
7. `assets/sample-data.json`: vzorová data. Používat jen je, nikdy skutečné firmy.
8. `reference/`: obrázky.
   - `pillars/`: schválené pilíře, nesahat.
   - `current/`: dnešní stav v cílových velikostech, tedy to, co je špatně.
   - `mockups/`: už schválený směr pro Faktury, Platby, Nástěnku, Zákazníky a Tvorbu faktury.
   - `html/`: zdrojové HTML těchto mockupů jako vzor kódu.

## Šablona promptu

Do nového chatu nahraj celý zip a pošli:

```text
Jsi UI designer a frontend vývojář. V příloze je balíček „Splatno — responzivní mockupy“.
Přečti README.md a pak soubory 01–06. Řiď se jimi doslova; pravidla v 02_TRANSITION_RULES.md
jsou závazná a mají přednost před tvým vlastním vkusem.

Vytvoř mockup stránky: <NÁZEV STRÁNKY, např. „Upomínky“ / „Reporty“ / „Nastavení“ / „Detail faktury“>
ve velikosti okna: <ŠÍŘKA × VÝŠKA, např. 1024 × 768>.

Podklady k této stránce: <popis obsahu stránky nebo přiložený screenshot pilíře MacBook a mobil>.

Odevzdej:
1. jeden samostatný soubor HTML podle 04_OUTPUT_AND_CHECKLIST.md (vložené CSS z assets/base.css,
   ikony z assets/icons.js, vzorová data z assets/sample-data.json),
2. krátký seznam: co se oproti pilíři MacBook změnilo a podle kterého pravidla (číslo pravidla),
3. vyplněný kontrolní seznam z 04_OUTPUT_AND_CHECKLIST.md.
```

Pro další velikost téže stránky stačí v tomtéž chatu napsat:
`Teď stejnou stránku ve velikosti 1920 × 1080. Drž se stejných komponent a pravidel.`

## Co se nesmí

- Měnit pilíře (mobil, MacBook) ani vymýšlet nový vizuální styl, barvy nebo písmo.
- Zvětšovat celé UI „lupou“ na velkých obrazovkách (pravidlo 6).
- Zkracovat částky, čísla faktur, variabilní symboly a data (pravidlo 8).
- Nechávat prázdnou plochu pod posledním panelem nebo uvnitř velkých karet (pravidla 2 a 11).
- Zapomenout pozadí aplikace, logo, Eska nebo avatar; malá a prázdná navigace na velkém displeji (pravidla 5 a 14).
- Sloupce, které nejsou ve všech řádcích na stejném místě (pravidlo 13).
- Používat skutečná jména firem, e-maily nebo IČO. Jen `assets/sample-data.json`.
- Přidávat funkce, které aplikace nemá. Mockup mění rozložení, ne funkčnost.


## Další velikost a otevřený stav

Po stránkovém mockupu pokračuj např.:
`Teď Faktury, invoices-row-actions, otevřené menu v posledním řádku, 1024 × 768.
Postupuj podle dokumentů 05 a 06 a odevzdej i kontrolu klávesnice a okrajů viewportu.`
Pro formulář: `Tvorba faktury, creation-customer-dialog, validační chyba, 2560 × 1440.`
Otevřené stavy se odevzdávají samostatně podle dokumentu 05; nejsou pokryté jediným
screenshotem zavřené stránky ani samotným geometrickým skriptem z dokumentu 04.
