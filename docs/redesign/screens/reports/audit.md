# Audit reportů před úpravou

Zdroj: existující `/reports`, `report-query.ts`, `report-page-data.ts`, API reports,
SQL `invoice_report_summary` a `payment_reconciliation_summary` (poslední definice),
`role-access.ts`, tiskový dokument a XLSX handler. Návrhy jsou vizuální reference.

- Jedna routa, čtyři lokální záložky; výchozí filtr rok do dneška, CZK, vystavení,
  všechny stavy i odběratelé. Zachovat při přepínání.
- `invoice_report_summary`: všechny agregace z jedné populace firmy, měny,
  stavu/odběratele a zvoleného datumového pole. `total`, průměr, DPH i koncentrace
  zahrnují storna, pokud nejsou odfiltrována. To neměnit potichu.
- `paid` je současný součet paid_amount nestornovaných vybraných faktur, nikoli
  peněžní tok plateb v intervalu. `monthly` řadí OBA sloupce podle issue_date.
  Labely musí popsat tuto skutečnost, žádné „přijaté během období“.
- `open` = amount - paid_amount pending/overdue; `overdue` podle aktuálního statusu.
  Aging podle due_date a dnešního Europe/Prague dne, buckets před splatností včetně
  dneška, 1–7, 8–14, 15–30, nad30. Nejde o historický snapshot! Zachovat všech pět.
- DPH je jedna sazba na celé faktuře, base z amount_without_vat a tax=gross-base.
  Reporting nepoužívá položkové sazby ani DUZP; žádný odpočet/přiznání.
- Koncentrace: top10 + agregát Ostatní. UI může bezpečně vybrat top5 a zbytek
  přičíst do označeného zbytku; agregát Ostatní není skutečný zákazník.
- Platby: jen potvrzené výpisy podle committed_at Europe/Prague; accepted_count,
  přijaté řádky s proposal_confidence safe vs review/null. Ruční posouzení není
  otevřená práce. unmatched_payments je jiná populace podle booked_on.
  Nemíchat tyto počty do 100% grafu. Chybí currency/status/customer filtry pro tuto
  část, chybí částky, datumové řady jednotlivých plateb a poslední platby.
- Role viewer/accounting/admin smějí reporty i XLSX. Zvláštní exportní právo
  neexistuje; nevymýšlet ho. Viewer nesmí provozní /invoices/payments ani archiv.
  Tenant/actor pouze z identity, RPC kontroluje členství; nezměnit.
- XLSX: stávající handler exportuje filtrované faktury (max20k), DPH a aging.
  Neexportuje bankovní přehled ani metadata metodiky. Print/PDF tiskne existující
  celý souhrnný dokument se všemi kapitolami. Rozsah musí být jasný v export menu.

## Kontrakty případných budoucích backend rozšíření (neimplementovat)

1. Tok úhrad: transakční agregace dle skutečného dne platby, částky, měny,
   přidělených alokací, opravy/storna a deduplikace ve stejném tenant scope.
2. Historický aging: snapshot nebo rekonstrukce platných alokací k datu,
   historické storno a statusy. Nestačí odečíst dnešní paid_amount.
3. Platební report: vlastní měnové/účtové filtry, potvrzené transakce bez duplicit
   a odchozích řádků, split jednou, propojení na bezpečné detail routy; neslučovat
   návrhy a potvrzené automatické párování. Samostatný autorizovaný export se
   souhrny/obdobím/metodikou. Rizika: duplicitní částky, jiné měny, tenant leak.
4. DPH: položkové sazby, DUZP a daňové režimy vyžadují explicitní datový kontrakt.

Změny v tomto úkolu: prezentace a čisté selektory; bez změny API, DB, RLS,
parseru, párování, zápisů nebo finančních výpočtů. Měnová agregace plateb se
vůbec nezavádí. Testy používají syntetická data a izolovaný prohlížeč.
