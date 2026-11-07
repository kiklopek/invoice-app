# 03 — Specifikace stránek

Každá stránka patří do **rodiny**, která určuje základní chování (pravidlo 10):

| Rodina       | Chování výšky                                                | Stránky                                          |
| ------------ | ------------------------------------------------------------ | ------------------------------------------------ |
| `overview`   | statický viewport, karty vyplní výšku                        | Nástěnka, Reporty                                |
| `collection` | statický viewport, panel záznamů vyplní zbytek, řádky dle výšky | Faktury, Archiv faktur, Zákazníci, Archiv plateb, Oznámení |
| `task`       | statický viewport, pracovní panel vyplní zbytek              | Platby (nahrání výpisu), Import faktur           |
| `form`       | přirozená výška, stránka se posouvá, akce/náhled sticky      | Tvorba faktury, Ruční faktura, Nastavení, Upomínky, Předplatné |
| `document`   | přirozená výška, dokument a souhrn vedle sebe, akce sticky   | Detail faktury                                   |

Pilíře každé stránky: `reference/pillars/<stránka>--mobil-390.png` a `--macbook-1470x830.png`.
Dnešní (špatný) stav: `reference/current/`. Schválený směr: `reference/mockups/`.

Legenda: ✅ směr schválený (existuje mockup) · 🟡 navrhnout podle pravidel.

---

## ✅ Faktury (`invoices`, collection)

- **Obsah:**
  - hlavička: eyebrow „FAKTURY“, nadpis „Všechny faktury“, podtitulek; vpravo karta součtu,
  - filtry: Stav, Seřadit podle, Datum vystavení (od–do), Datum splatnosti (od–do), „Další filtry“,
  - tabulka a stránkování.
- **Dnes:** tabulka má pevnou minimální šířku 1090 px. Na 1024 a 1180 se useká na sloupci Stav nebo Uhrazeno. Na velkých obrazovkách se celé UI zvětšuje lupou.
- **1024 × 768:**
  - navigace jako rail 84 px, kompaktní hlavička (32 px, bez podtitulku),
  - filtry v 1 řadě: Stav, Seřadit, tlačítko „Datum a další“ (otevře popover),
  - sloupce: ☐ · Faktura · Odběratel · Částka · Splatnost · Stav (+ mini pruh úhrady u částečných) · ⋯,
  - ~6 řádků na stránku.
- **1180 × 820:** sidebar 220 px. Obsah je stejně široký jako na 1024 s railem, takže sloupce jsou stejné. ~7 řádků.
- **1920 × 1080:**
  - sidebar 264 px, text +1 px,
  - filtry v 1 řadě se všemi poli,
  - navíc sloupce Vystaveno, Uhrazeno (pruh + %) a Upomínky,
  - ~9–10 řádků.
- **2560 × 1440:**
  - jako 1920 a text +2 px,
  - vpravo panel detailu vybrané faktury (400 px) na plnou výšku: stav, částka, údaje, položky, platební údaje, historie; akce „Poslat upomínku“ a „Označit jako uhrazenou“ přilepené dole,
  - ~14–15 řádků.

## ✅ Nástěnka (`dashboard`, overview)

- **Obsah:**
  - pozdrav s datem a výběr období,
  - 4 KPI: Celkem faktur, Čeká na splatnost, Po splatnosti, Zaplaceno,
  - graf „Faktury v čase“ (skládané sloupce po měsících),
  - „Stav faktur“ (donut s legendou),
  - „Poslední faktury“ (seznam),
  - „Nejbližší upomínky“ (seznam).
- **Rozložení:** 3 pásy pod sebou: KPI, grafy (2 : 1), seznamy (2 : 1). Grafy mají pevnou výšku a seznamy vyplní zbytek. Počet řádků seznamů se řídí výškou.
- **1024:**
  - rail; seznamy v kompaktní podobě (jméno + číslo faktury pod sebou),
  - u upomínek jen číslo faktury, bez slova „Faktura“ a bez data; čísla se nezkracují,
  - donut v úzké kartě: menší, procenta v legendě skrytá.
- **1920 / 2560:**
  - KPI hodnoty rostou (46 / 56 px), ikony KPI až 68 px,
  - donut roste s kartou, graf je vyšší,
  - seznamy mají víc řádků a samostatný sloupec čísla faktury.

## ✅ Zákazníci (`customers`, collection)

- **Obsah:** vyhledávání, počet nalezených, tabulka a „Export do Excelu“. Sloupce:
  - Zákazník (iniciála, název, IČO, DIČ, adresa),
  - Kontakt (e-mail, telefon nebo „+ Přidat telefon“),
  - Fakturace (součet + počet faktur),
  - Neuhrazeno (barevný štítek částky nebo „Uhrazeno“),
  - Upomínky (kategorie), Poslední faktura, ⋯.
- **Dnes:** řádky vysoké 106–160 px, e-mail se láme uprostřed slova.
- **1024:**
  - řádek: název + IČO / e-mail + telefon / Fakturace / Neuhrazeno / ⋯,
  - adresa schovaná, e-mail zkrácený třemi tečkami (celý v tooltipu),
  - ~6 řádků.
- **1180:** navíc sloupec „Poslední“.
- **1920:** všechny sloupce, adresa v řádku za IČO.
- **2560:** panel detailu zákazníka (420 px): dlužná částka, údaje, otevřené faktury, poslední platby; akce dole.

## ✅ Platby — nahrání výpisu (`payments`, task)

- **Obsah:**
  - hlavička „Spárujte platby s fakturami“ a karta „Platby a archiv“,
  - panel: vlevo nahrání výpisu (dropzóna GPC / CSV), vpravo tmavě zelený panel „Párování pod kontrolou“ (3 kroky).
- **Pravidla:**
  - celé se vejde do okna,
  - obsah tmavého panelu je vycentrovaný jako blok a text roste s panelem,
  - na 1024–1180 se skryje podtitulek hlavičky a popisek karty archivu.
- Snímky `reference/mockups/payments-*.png` jsou už **skutečná opravená aplikace**.

## ✅ Tvorba faktury (`invoice-create`, form)

- **Obsah:**
  - vlevo formulář: Základní údaje (odběratel, fakturační údaje, čísla, data, měna, úhrada, účet), Položky faktury, Poznámky, Příloha,
  - vpravo náhled faktury (dokument) a akce: „Vystavit a odeslat fakturu“, „Stáhnout PDF“, „Zobrazit PDF“, „Uložit koncept“.
- **Pravidla:**
  - stránka se posouvá; náhled s akcemi je sticky a jde s oknem, takže pod ním nevzniká prázdný sloupec,
  - náhled se nikdy neusekává,
  - na 1024 se akční tlačítka skládají pod sebe a popisek „Šablona“ zmizí.
- **1920 / 2560:** formulář má 3 sloupce, každý řádek zaplněný. Položky v jednom řádku (Položka, Množství, Jednotka, Cena, DPH, Celkem).

---

## 🟡 Upomínky (`reminders`, form)

- **Obsah:**
  - banner stavu automatu („Automatické odesílání je pozastavené“ + přepínač),
  - 2 KPI: Naplánováno, Vyžaduje kontrolu,
  - výběr „Kategorie upomínek“ + „Přidat kategorii“,
  - editor „Kdy se mají upomínky posílat?“: kroky (číslo, počet dní, výběr před/po splatnosti, ×) a uložení,
  - vpravo „Jak bude proces probíhat“ (časová osa s daty),
  - sbalitelný „Provozní přehled a historie“.
- **Navrhnout:**
  - 1024: časovou osu dát pod editor, nebo ji zúžit na 280 px; kroky editoru v 1 řádku (číslo · dní · výběr · ×),
  - 1920+: časová osa vyplní výšku editoru, KPI rostou s kartou; nenechávat prázdno pod osou (pravidlo 11).

## 🟡 Reporty (`reports`, overview)

- **Obsah:**
  - záložky Tržby / DPH / Pohledávky / Platby,
  - přepínač období (Tento měsíc, Toto čtvrtletí, Tento rok, Vlastní) + rozsah dat, „Další filtry“,
  - 4 KPI: Fakturováno, Evidované úhrady, Otevřené pohledávky, Průměrná faktura,
  - graf „Fakturace a evidované úhrady“ (dvojité sloupce po měsících),
  - „Tržby podle odběratelů“ (top 5 s pruhy),
  - sbalitelné „Další přehledy a metodika“, „Exportovat“.
- **Navrhnout:**
  - 1024: KPI 4 v řadě s menšími hodnotami (částky se nezkracují, raději 2 × 2), graf přes celou šířku, top odběratelé pod ním nebo vedle v 1 : 1,
  - velké obrazovky: graf a top odběratelé vyplní výšku, víc odběratelů (top 8–10).

## 🟡 Detail faktury (`invoices-detail`, document)

- **Obsah:**
  - drobečková navigace, nadpis „Faktura č. …“ se štítkem stavu, akce „⋯“, „Smazat fakturu“, „Potvrdit úhradu“,
  - vlevo: karta částky (velká červená částka + DPH) s údaji (číslo, VS, data, způsob zadání, kategorie upomínek), „Odběratel a kontakt“, „Historie faktury“,
  - vpravo: „Dokument faktury“ (náhled PDF), „Automatické upomínky“ (přepínač, další upomínka, historie).
- **Navrhnout:**
  - 1024: pravý sloupec 320 px, nebo dokument pod obsahem,
  - velké obrazovky: dokument roste do výšky okna, pod historií nezůstává prázdno.

## 🟡 Nastavení (`settings`, form)

- **Obsah:**
  - „Firemní údaje“ v sekcích s popiskem vlevo a poli vpravo: Údaje firmy, Kontaktní údaje, Platební údaje, sbalitelné Doplňující údaje a Další bankovní účty,
  - „Přístupy účetního oddělení“ (členové, pozvánka) a vedle „Význam rolí“,
  - „Historie změn přístupů“.
- **Navrhnout:**
  - 1024: popisek sekce nad poli místo vlevo,
  - velké obrazovky: max šířka formuláře ~1280 px, sekce ve 2 sloupcích jen pokud jsou krátké.

## 🟡 Další stránky

Pilíře jsou v `reference/pillars/`. Rodina je uvedená v tabulce nahoře.
- **Archiv faktur** (`invoices-archive`): stejné jako Faktury.
- **Ruční faktura** (`invoices-new`): stejné jako Tvorba faktury.
- **Import faktur** (`invoices-import`): stejné jako Platby. Zelený panel „Rozpoznání pod kontrolou“ je už vycentrovaný.
- **Archiv plateb** (`invoices-payments-archive`): jako Faktury, řádky výpisů.
- **Oznámení** (`notifications`): collection, seznam událostí.
- **Předplatné** (`predplatne`): form; karta plánu, historie plateb.

Mobil (< 640) a MacBook (1470) se u žádné stránky nemění.
