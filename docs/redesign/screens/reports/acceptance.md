# Reporty — výsledek implementace

Přepracována existující `/reports`, záložky Tržby / DPH / Pohledávky / Platby.
Zachovány AppShell, společná navigace, profil, Eško, pozadí a globální akce.
Bez změny API handlerů, SQL, RLS, schématu, parseru, párování nebo účetních zápisů.
Výchozí filtr je nadále letošní rok do dneška, CZK a datum vystavení.

## Výsledné chování

- Samostatný nadpis aktivní záložky, společné záložky ovladatelné šipkami/Home/End.
- Kompaktní rychlé období + od/do; datumové pole, měna, stav a odběratel pod
  Další filtry. Záložky filtry zachovávají, data načítá stejný composite endpoint.
- Nový výběr nikdy nezobrazuje staré součty s novou měnou nebo datem. Loading,
  chyby a opakování mají samostatné stavy. Neplatné datum nepovolí export/tisk.
- Tržby: čtyři KPI, měsíční fakturace + současné evidované úhrady podle vystavení,
  Top5 (bez syntetického agregátu Ostatní) a explicitní součet zbývajících.
  Klik na skutečného odběratele filtruje celý report. Další koncentrace, meziroční
  data a metodika na požádání. Prázdný průměr = —, žádná vymyšlená procenta.
- U jiného datumového pole měsíční graf vystavení skryt s vysvětlením, místo
  vykreslení měsíců mimo vybraný rozsah; dostupné souhrny zůstávají správně.
- DPH: čtyři KPI, dynamické sazby z RPC, tabulka se součtem a podíl na celkové
  částce s DPH. „Hlavní“ sazba je popsána jako sazba s největším objemem.
  Bez nových sazeb či odpočtů; upozornění na jednu sazbu/fakturu a absenci DUZP.
- Pohledávky: současné zůstatky vybraných faktur k dnešku, pět KPI, všech pět
  původních aging buckets, přehled a donut. Nulové/záporné báze se nepřevádějí
  na zavádějící procenta. Dlužníci nejprve5, na požádání10; DSO skryt v detailu.
- Platby: pouze skutečně dostupné počty. Bezpečný návrh ≠ automatický původ
  zaúčtování. Nespárované nejsou součástí 100% podílu jiné populace. Měsíce dle
  zaúčtování výpisu. Výpisy max5, s přijatými/ignorovanými/chybnými řádky.
  Transakce nejsou fingované — funkční odkaz na existující párování, historie
  výpisů přes existující archiv. Viewer tyto provozní odkazy nedostává.
- Přesné částky včetně haléřů; pouze středy donutů používají kompaktní zápis.
  Graf má měřítko, hover/focus tooltip s přesnou hodnotou, klávesnicí zaměřitelné
  sloupce; záporné částky mají šrafování a vysvětlení.
- XLSX používá původní handler a všechny aktuální fakturové filtry. Menu výslovně
  uvádí tři původní listy (faktury/DPH/aging) a absenci bankovních výpisů.
  Tisk/PDF používá existující úplný dokument; doplněna metodika rozsahů a opraveny
  zavádějící popisky plateb, zachován layout tisku. Bez ztráty haléřů v PDF.

## Ověření

- 58 Vitest testů / 10 souborů: report-query, reporting, report-presentation,
  report-print, report-page-data, API reports, payment-reconciliation-query,
  role-authorization, excel-export, workspace-performance. Obsahují částečné
  úhrady, splatnost právě dnes, storno, prázdné reporty, proměnlivé sazby, haléře,
  záporné korekce, oba tenanty v paralelních RPC požadavcích, serverová oprávnění,
  XLSX s přesnými hodnotami a odmítnutí příliš velkého exportu.
- 10 Chromium scénářů, reálný AppShell a klient, syntetické odpovědi:
  všechny4záložky ×1536×1024 /1440×900 /390×844 (12screenshotů), horizontální
  overflow, měna, zachování filtrů, drilldown, focus tooltip, loading/error/retry,
  žádná zastaralá data při novém filtru, export request parametry, empty/negative,
  viewer, neplátce a existující tiskový dokument/PDF. Žádné skutečné finanční akce.
- TypeScript, cílený ESLint, izolovaný produkční build Next.js prošly.
- Neproběhlo nasazení, push ani přístup k produkčním finančním datům.

## Soubory

- `src/app/(workspace)/reports/reports-client.tsx` — existující klient.
- `src/app/(workspace)/reports/reports.module.css` — lokálně omezené styly.
- `src/app/(workspace)/reports/report-print-document.tsx` — metodika a popisky,
  haléře při tisku; původní struktura tisku.
- `src/lib/report-presentation.ts` — čisté selektory a rychlá období.
- Nové testy `src/lib/report-presentation.test.ts`, `src/lib/report-page-data.test.ts`,
  `src/app/api/reports/route.test.ts`; rozšířen `src/lib/report-query.test.ts`.
- `src/lib/report-print.test.ts` — zachované tiskové regrese; staré snapshoty
  konkrétních screen CSS tříd nahrazeny funkčním prohlížečovým ověřením redesignu.
- `scripts/reports-design-fixtures.mjs`, `scripts/reports-design-check.mjs`.
- `docs/redesign/screens/reports/audit.md`, tento soubor, vizuální artefakty níže.

## Limity původního backendu / neimplementované části reference

1. Přehled jednotlivých bankovních plateb, jejich částek/protistran a denní graf:
   současný composite kontrakt je nemá. Nenahrazeny testovacími daty ani novým API.
   Podrobnosti jsou dostupné přes oprávněný proklik do stávajícího párování.
2. Procenta meziroční změny KPI, historický snapshot pohledávek a peněžní tok úhrad
   podle skutečného dne částečných plateb nejsou doplněny. Graf řadí oba sloupce
   podle vystavení a nese správnou metodiku.
3. Bankovní souhrn nemá filtr měny/odběratele/stavu ani peněžní částky; zde se
   používá pouze interval a počty celé firmy. Fakturové filtry zůstávají uložené.
4. XLSX nemá list s metodikou/obdobím ani platební souhrn; menu přesný rozsah
   vysvětluje, jméno souboru nese datum/měnu. Samostatný platební export a rozšíření
   XLSX vyžadují změnu existujícího serverového kontraktu, nejsou zde přidány.
5. Existující XLSX handler počítá rozhodný den aging v UTC, obrazovka v Praze.
   V úzkém okně kolem místní půlnoci se aging může lišit o den. API se v tomto
   prezentačním úkolu nemění; sjednocení data je samostatná serverová oprava.
6. Existující všechny tři role mohou exportovat reporty; role „viewer bez exportu“
   neexistuje. Test odmítnutého exportu používá nepřihlášenou/neoprávněnou identitu.
7. Žádná nová přímá akce na konkrétní výpis: API souhrnu má import ID, nikoli
   schválený detailový navigation kontrakt. Odkaz vede na existující archiv.
8. Úprava nezavádí pravidla pro více sazeb na jedné faktuře, reverse charge,
   dobropisy či nárok na odpočet; není prezentována jako daňové přiznání.

## Screenshoty

Testovací jména/částky jsou pouze fixture pro ověření rozhraní, nejsou v produktu.

| Záložka | 1536×1024 | 1440×900 | Mobil 390×844 |
|---|---|---|---|
| Tržby | [náhled](../../visual-validation/reports/revenue-1536x1024.png) | [náhled](../../visual-validation/reports/revenue-1440x900.png) | [náhled](../../visual-validation/reports/revenue-390x844.png) |
| DPH | [náhled](../../visual-validation/reports/vat-1536x1024.png) | [náhled](../../visual-validation/reports/vat-1440x900.png) | [náhled](../../visual-validation/reports/vat-390x844.png) |
| Pohledávky | [náhled](../../visual-validation/reports/receivables-1536x1024.png) | [náhled](../../visual-validation/reports/receivables-1440x900.png) | [náhled](../../visual-validation/reports/receivables-390x844.png) |
| Platby | [náhled](../../visual-validation/reports/payments-1536x1024.png) | [náhled](../../visual-validation/reports/payments-1440x900.png) | [náhled](../../visual-validation/reports/payments-390x844.png) |

[Prohlížečové výsledky](../../visual-validation/reports/validation.json) ·
[PDF testovacího reportu](../../visual-validation/reports/report.pdf)

## Následná úprava podle požadavku uživatele

Ze záložky Platby odstraněny obě spodní karty Poslední platby a Importované výpisy včetně jejich odkazů. Na obrazovce zůstává souhrn a grafy. Původní úplný tiskový dokument se tím nemění.

### Oprava responzivity částek

Karty metrik nyní volí počet sloupců podle dostupné šířky (minimálně220px,
na užším displeji celá šířka). Částky mají nezalomitelný řádek a písmo řízené
šířkou své karty, nikoli celého viewportu. Odstraněno vynucených pět sloupců.
Prohlížečová kontrola rozšířena na8šířek:320,390,768,1024,1280,1440,1536,1920px,
vždy všechny4záložky. Ověřuje šířku skutečného textu i jeho výšku, takže nestačí
pouze skrýt přetečení. Všech15scénářů prošlo, screenshoty aktualizovány.

### Zarovnání přehledu podle splatnosti

Řádky sdílejí sloupce přes CSS subgrid. Sloupec částek se dimenzuje podle
nejdelší aktuální hodnoty, všechny pruhy mají stejný začátek i délku podkladu.
Obsah je v kartě vystředěný; na mobilu se pruh přesouvá pod popis a částku.
Doplněno8prohlížečových kontrol pro nulu, haléře a miliardové hodnoty; všech23
scénářů prošlo. Nové náhledy `aging-changing-1536.png` a `aging-changing-390.png`.

### Odstranění duplicitních údajů na Pohledávkách

Kruhová Struktura pohledávek odstraněna: opakovala stejný aging jako levá karta.
Místo ní je Platební disciplína z existujících `dso` / `dso_monthly`: průměr od
vystavení do úplné úhrady, počet plně uhrazených faktur, poslední3měsíce a starší
měsíce na požádání. Původní spodní rozbalovací disciplína odstraněna, aby se
nekopírovala. Částečné úhrady nejsou započítané do tohoto průměru; prázdná data
mají vysvětlení a hodnotu —. Bez backendových nebo kalkulačních změn.
Všech23prohlížečových scénářů prošlo; doplněna kontrola nového obsahu a absence
duplicitního kruhového grafu na všech8šířkách.

### Přehled odběratelů v okně

Dřívější rozbalená tabulka nahrazena tlačítkem Přehled odběratelů a sdíleným
nativním Modalem. Pevná hlavička, hledání bez diakritiky, počet výsledků a
samostatně scrollovatelný seznam. Hledá všechny skutečné názvy z tenant-scoped
`customers`, nejen Top10. Částka/počet faktur pouze tam, kde je vrací koncentrace;
u dalších odběratelů nabídka výběru pro načtení detailu, nikoli falešná nula.
Výběr aplikuje existující filtr a zavře okno. Escape i křížek zavírají; kurzor se
vrací na spouštěcí tlačítko. Nativní focus trap; hledání získá počáteční fokus.
Při více než100shodách se vykreslí prvních100 s výzvou zpřesnit hledání; hledání
stále prochází celý dostupný seznam. Testy popupu desktop/mobil přidány do
prohlížečového ověření. Náhledy customers-modal-1536.png / customers-modal-390.png.

### Zrušení filtru odběratele a vzhled hledání

Vnitřní zelený focus rámeček hledání odstraněn; fokus označuje jemný neutrální
okraj celého pole. Vybraný odběratel má vždy viditelný štítek v hlavní filtrační
kartě, i když jsou Další filtry sbalené. Křížek ruší pouze odběratele, vrací výběr
na všechny firmy a zachovává období, měnu a ostatní filtry. Platební záložka
štítek nezobrazuje, protože na ni fakturový filtr nemá vliv. Prohlížečové testy
popupů rozšířeny o kontrolu focus stylu i resetu a zachování ostatních voleb.

### Jediná řada souhrnných karet (nahrazuje dřívější zalamování karet)

Podle následného požadavku karty nikdy nepřecházejí do druhé řady. Desktop má
rovnoměrné sloupce podle skutečného počtu karet, na užším displeji samostatný
horizontální posuv se zachovanou čitelností. Částky od 1 000 000 se zapisují kompaktně, např. 2,365 M Kč; vyšší řády mld./bil. Přesné částky jsou v title
na hodnotě a v přístupném názvu. Zdrojové částky, tabulky a exporty zůstávají beze
změny. Písmo reaguje na šířku karty; čísla se nezalamují. Kontrola jediné řady i
nezalomitelnosti všech hodnot ve všech záložkách na8šířkách je nyní součástí
prohlížečových testů. Čistý formatter má testy pro nulu, záporné částky, CZK/EUR,
přechod milion/miliarda a biliony.
