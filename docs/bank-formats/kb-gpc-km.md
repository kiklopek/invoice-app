# KB „klientský formát KM" (GPC/ABO) — závazná reference

**Zdroj pravdy:** [kb-klientsky-format-km.pdf](./kb-klientsky-format-km.pdf), Komerční banka, platné od 25. 6. 2025, id `KLI_FORM_KM`.

Tenhle dokument je **povinné čtení před jakoukoli změnou v parsování bankovních výpisů**. Formát obsahuje dvě věci, které z holého souboru nelze uhodnout a které se už jednou tiše rozbily — permutovaná čísla účtů a kód banky schovaný v poli konstantního symbolu.

Implementace: [`src/lib/gpc-parser.ts`](../../src/lib/gpc-parser.ts). Testy: [`src/lib/gpc-parser.test.ts`](../../src/lib/gpc-parser.test.ts).

## Základní vlastnosti

- Soubor pevné délky, **128 znaků na řádek** + CRLF.
- Kódování **Windows-1250**. Uložení v UTF-8 rozsype diakritiku.
- Přípona vždy `.GPC`, i když je to formát KM.
- Jeden soubor = jeden účet a jeden obchodní den. Multiměnový účet dává samostatný soubor na každou měnu.
- GPC **nemá žádné pole pro zprávu pro příjemce**. Volitelné věty 078/079 s doplňujícím textem KB neposílá. Co aplikace ukazuje jako poznámku, si skládá sama z čísla dokladu.

## Čísla účtů jsou permutovaná — nejdůležitější past

Čísla účtů se zapisují ve **vnitřním formátu**, což je přeházené pořadí číslic edičního (normálního) formátu:

```
ediční   N1  N2  N3  N4  N5  N6  N7  N8  N9  N10 N11 N12 N13 N14 N15 N16
vnitřní  N16 N14 N15 N12 N7  N8  N9  N10 N11 N13 N1  N2  N3  N4  N5  N6
```

Čtené tak, jak leží, to **není číslo účtu, ale jeho přesmyčka**. Ediční formát je `prefix(6) + číslo účtu(10)`.

Ověřeno na reálném výpisu tohoto účtu:

| vnitřní (v souboru) | ediční (skutečný účet) |
|---|---|
| `7252678640000000` | `6786420257` — účet vytištěný na fakturách |
| `3514011780000000` | `117840513` (C.S.CARGO) |
| `7214662570000107` | `107-6625740217` (ESTIMATIC) |

**Kontrola, kterou vždy použij:** dekódované číslo musí projít českou váženou mod-11 číslicí — prefix s vahami `10,5,8,4,2,1`, účet s vahami `6,3,7,9,10,5,8,4,2,1`, součet dělitelný 11. Všech pět účtů z reálného výpisu ji dekódovaně projde a syrově neprojde. To je nejrychlejší způsob, jak poznat, že se formát čte špatně.

**Permutaci aplikuj jen na soubory, které se jako KM identifikují** — kanál `MB` na pozicích 123–124 hlavičky, nebo IBAN předpona `CZ` + modulo97 + kód banky na 115–122. Výpisy z jiných bank nesou ediční formát rovnou a permutovat je by je rozbilo.

## Věta 074 — hlavička

| Poz. | Délka | Obsah |
|---|---|---|
| 1–3 | 3 | `074` |
| 4–19 | 16 | číslo účtu klienta, **vnitřní formát** |
| 20–39 | 20 | zkrácený název účtu — KB **neplní** |
| 40–45 | 6 | datum starého zůstatku `ddmmrr` |
| 46–59 | 14 | starý zůstatek |
| 60 | 1 | znaménko starého zůstatku |
| 61–74 | 14 | nový zůstatek |
| 75 | 1 | znaménko nového zůstatku |
| 76–89 | 14 | obraty debet |
| 90 | 1 | znaménko obratů debet |
| 91–104 | 14 | obraty kredit |
| 105 | 1 | znaménko obratů kredit |
| 106–108 | 3 | pořadové číslo výpisu v roce |
| 109–114 | 6 | datum účtování `ddmmrr` |
| 115–122 | 8 | IBAN: kód země + modulo97 + **kód banky** |
| 123–124 | 2 | označení kanálu, `MB` při generování v KB+ |
| 125–128 | 4 | mezery |

## Věta 075 — obratová položka

| Poz. | Délka | Obsah |
|---|---|---|
| 1–3 | 3 | `075` |
| 4–19 | 16 | číslo účtu klienta, **vnitřní formát** |
| 20–35 | 16 | číslo protiúčtu, **vnitřní formát** |
| 36–39 | 4 | číslo dokladu č. 1 — datum pořízení `mmdd` |
| 40–42 | 3 | konstanta `000` |
| 43–48 | 6 | číslo dokladu č. 3 — **číslo výpisu**, ne identifikátor transakce |
| 49–60 | 12 | **částka v haléřích** |
| 61 | 1 | **kód účtování**: `1` debet, `2` kredit, `4` storno debet, `5` storno kredit |
| 62–71 | 10 | **variabilní symbol** |
| 72–81 | 10 | pole konstantního symbolu — viz níže |
| 74–77 | 4 | **kód banky protiúčtu** (leží uvnitř pole KS) |
| 82–91 | 10 | specifický symbol |
| 92–97 | 6 | valuta `ddmmrr`; `000000` = shodná s datem účtování |
| 98–117 | 20 | **jméno partnera**, useknuté na 20 znaků |
| 118 | 1 | kód změny položky, vždy `0` |
| 119–122 | 4 | druh dat — KB neplní |
| 123–128 | 6 | **datum odepsání** `ddmmrr` |

### Pole konstantního symbolu (72–81)

Nese tři věci najednou, protože se do něj vešel i kód banky:

- pozice 74–77 = **kód banky protiúčtu** (ověřeno: 0100 KB, 0300 ČSOB, 0600 MONETA, 3030 Air Bank — u ESTIMATIC i C.S.CARGO souhlasí s bankou na jejich faktuře)
- poslední 4 číslice = **skutečný konstantní symbol** podle ČNB (např. `0308`)

Citace ze specifikace: *„Konstantní symbol v rámci KM umožňuje zadat pouze 4 pozice, protože v rámci KM se předávají i informace o kódu banky. V rámci GPC tedy obdržíte 4 poslední znaky z KS."*

## Kontrolní součty výpisu

Specifikace nabízí ověření integrity souboru, které zatím **nepoužíváme** a stálo by za zvážení:

```
NZ = SZ - OD + OK
OD = suma položek s kódem účtování 1 (+) nebo 4 (−)
OK = suma položek s kódem účtování 2 (+) nebo 5 (−)
```

kde `NZ` nový zůstatek, `SZ` starý zůstatek (obojí z věty 074). Neshoda znamená neúplný nebo poškozený soubor.

## Co zatím nečteme

- **specifický symbol** (82–91) — u plateb typu „MOJE ODMENY" tam KB dává vlastní číslo účtu klienta; pro párování faktur se v ČR používá zřídka
- **konstantní symbol** (poslední 4 číslice pole 72–81)
- **valuta** (92–97)
- kontrolní součty zůstatků z věty 074

## Známá omezení formátu proti CAMT.053

Jméno partnera je useknuté na 20 znaků a **zpráva pro příjemce v GPC neexistuje**. To jsou dvě pole, která párování nejvíc chybí, a jediný způsob, jak je získat, je jiný formát výpisu — ne konverze GPC na CSV, protože ta data ve zdroji nejsou.
