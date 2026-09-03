# Databázový návrh Supabase

Databáze je víceuživatelská a všechny obchodní záznamy jsou oddělené pomocí `organization_id`. Prohlížeč používá pouze Supabase Auth a čtecí RLS politiky. Veškeré zápisy procházejí validovanými serverovými API routami se service role.

## Entity a vztahy

| Tabulka | Účel | Hlavní vztahy |
| --- | --- | --- |
| `organizations` | Firemní a fakturační údaje R. Hlavica s.r.o. | Kořen všech firemních dat |
| `organization_members` | Pozvánky, uživatelé a role `viewer`, `accounting`, `admin` | Firma → uživatel Supabase Auth |
| `organization_member_events` | Neměnná historie přidání, změn rolí a odebrání přístupů | Firma + administrátor + cílový e-mail |
| `reminder_policies` | Aktivace automatu a termíny relativně ke splatnosti | Firma → faktury |
| `email_templates` | Čtyři verzované typy textů upomínek | Firma + fáze upomínky |
| `invoices` | Vydané faktury, které mají odběratelé zaplatit | Firma, plán, autor, dokument |
| `invoice_uploads` | Krátkodobý bezpečnostní stav přímého uploadu | Firma, autor, výsledná faktura |
| `reminder_log` | Zámek, pokusy, chyby a historie každého e-mailu | Faktura + plánovaný den a fáze |
| `reminder_automation_runs` | Stav, čas a souhrn každého plánovaného běhu | Firma + sdílený identifikátor běhu cronu |
| `reminder_settings_events` | Neměnné snapshoty změn termínů a textů automatu | Firma + uživatel, který změnu uložil |
| `provider_webhook_events` | Idempotentní evidence přijatých Resend událostí bez obsahu zpráv | ID události + provider message ID |
| `email_suppressions` | Adresy zablokované po bounce nebo complaint | Firma + normalizovaný e-mail |
| `invoice_events` | Neměnná auditní historie obchodních změn | Faktura + případný uživatel |
| `bank_payments` | Přijaté bankovní transakce, výsledek párování a ochrana před duplicitou | Firma + případná faktura + importující uživatel |
| `storage.objects` | Originální PDF a obrázky v privátním bucketu | Cesta uložená ve faktuře |

## Důležité invarianty

- Číslo faktury je unikátní v rámci firmy.
- Jeden soubor lze připojit pouze k jedné faktuře.
- OCR stejného uploadu může běžet pouze jednou současně a databáze dovolí nejvýše tři pokusy.
- Splatnost nesmí být před datem vystavení a částka musí být kladná.
- Jeden krok upomínky je unikátní kombinací faktury, fáze a plánovaného dne.
- Úspěšné dokončení e-mailu a zvýšení počítadla probíhá atomicky funkcí `complete_reminder_send`.
- Doručovací webhook je idempotentní podle provider event ID a starší událost nepřepíše novější stav.
- Bounce nebo spam complaint vytvoří suppression a další automat ani ruční retry na tuto adresu neodešle zprávu.
- Uložení globálního plánu, šablon a přepočet dalších akcí probíhá atomicky funkcí `save_default_reminder_settings`.
- Stejná transakce uloží úplný snapshot nastavení i ověřený e-mail uživatele, který změnu provedl.
- Adresa pro odpověď a nejvýše pět interních kopií se validují, normalizují a ukládají ve stejném auditním snapshotu jako text šablony.
- Auditní trigger `audit_invoice_change` automaticky zaznamená založení, obchodní úpravy, úhradu, znovuotevření, storno a změnu pozastavení.
- Přidání člena, změna role i odebrání přístupu proběhne atomicky se zápisem do `organization_member_events`.
- Pozastavená, zaplacená nebo stornovaná faktura nemá naplánovaný další e-mail.
- ID bankovní transakce je unikátní v rámci firmy; opakovaný export proto nevytvoří druhou úhradu.
- Funkce `import_and_reconcile_bank_payments` importuje dávku atomicky a fakturu uzavře jen při jediné přesné shodě variabilního symbolu, měny a částky.
- Nespárované a nejednoznačné platby zůstávají samostatné a nemění stav žádné faktury.
- Ruční přiřazení funkcí `assign_bank_payment` je atomické, vyžaduje roli účetní nebo administrátora a databáze povolí pouze otevřenou fakturu se stejnou částkou a měnou.
- Jedna faktura smí mít nejvýše jednu spárovanou plnou platbu; její vrácení mezi neuhrazené atomicky uvolní platbu a znovu vyhodnotí neodeslané upomínky.
- Změna role a odebrání člena používají transakční zámek organizace, takže ani souběžné požadavky nemohou odebrat posledního administrátora.
- Každý běh automatu vytváří oddělený provozní záznam pro každou organizaci; nedokončený běh tak nelze zaměnit za úspěch.
- Pro jednu organizaci může běžet pouze jedna kontrola upomínek; opuštěný běh se po 90 minutách bezpečně uzavře jako neúspěšný.
- Globální cron přeskočí pouze organizaci s právě běžící ruční kontrolou; ostatní firmy bezpečně zpracuje a údržbu OCR omezí na stejnou sadu organizací.
- Provozní historie rozlišuje denní a ruční kontrolu; u ručního spuštění zachová uživatele a jeho e-mail.
- Seznam faktur filtruje, počítá souhrny a stránkuje přímo databáze; jeden běžný požadavek vrací nejvýše 25 řádků a export je bezpečně omezený.
- Reportovací metriky, grafy, stáří pohledávek a odběratelé se agregují přímo v databázi; prohlížeč nedostává celou historii faktur.

## Oprávnění

- `viewer`: pouze čtení firemních dat, faktur, reportů a historie.
- `accounting`: práce s fakturami, úhradami, dokumenty a upomínkami.
- `admin`: navíc firemní nastavení a správa členů.
- Role `anon` a `authenticated` nemají přímé `INSERT`, `UPDATE` ani `DELETE` oprávnění k aplikačním tabulkám.
- RLS filtruje čtení podle ověřeného členství v organizaci.
- Service role klíč existuje pouze na serveru a nikdy se neposílá do klientského JavaScriptu.

## Instalace

Pro nový projekt spusťte celý [schema.sql](./schema.sql). Historie migrací v `migrations/` odpovídá verzím evidovaným v propojeném Supabase projektu:

1. `20260808125414_initial_invoice_app_schema.sql`
2. `20260808125802_harden_rls_helper_functions.sql`
3. `20260808144309_email_mfa_challenges.sql`
4. `20260808183548_add_invoice_vat_amounts.sql`
5. `20260808194513_fix_report_label_encoding.sql`
6. `20260819203652_fix_member_role_audit_variable.sql`
7. `20260821094121_delete_member_auth_account.sql`

Před prvním nasazením počáteční migrace zkontrolujte, zda starší verze aplikace už nevytvořila dvě spárované platby pro jednu fakturu:

```sql
select invoice_id, count(*) as pocet, array_agg(external_id order by booked_on) as transakce
from bank_payments
where invoice_id is not null and match_status = 'matched'
group by invoice_id
having count(*) > 1;
```

Pokud dotaz něco vrátí, účetní musí nejprve určit správnou transakci. Migrace záměrně nepokračuje, protože automatický výběr by mohl změnit účetní stav nesprávně.

Před prvním nasazením počáteční migrace spusťte také tento preflight. Každý počet musí být `0`; migrace záměrně odmítne historicky nekonzistentní data namísto jejich tiché opravy:

```sql
select 'faktura/politika jiné firmy' as kontrola, count(*) as pocet
from invoices i join reminder_policies p on p.id = i.reminder_policy_id
where i.organization_id <> p.organization_id
union all
select 'událost/faktura jiné firmy', count(*)
from invoice_events e join invoices i on i.id = e.invoice_id
where e.organization_id <> i.organization_id
union all
select 'příloha/faktura jiné firmy', count(*)
from invoice_uploads u join invoices i on i.id = u.invoice_id
where u.organization_id <> i.organization_id
union all
select 'upomínka/faktura jiné firmy', count(*)
from reminder_log r join invoices i on i.id = r.invoice_id
where r.organization_id <> i.organization_id
union all
select 'platba/faktura jiné firmy', count(*)
from bank_payments p join invoices i on i.id = p.invoice_id
where p.organization_id <> i.organization_id
union all
select 'nekonzistentní stav úhrady', count(*)
from invoices where (status = 'paid') <> (paid_at is not null)
union all
select 'uzavřená faktura s další upomínkou', count(*)
from invoices where status in ('paid', 'cancelled') and next_reminder_at is not null
union all
select 'nekonzistentní stav odeslání', count(*)
from reminder_log
where (status = 'sent') <> (sent_at is not null)
   or (provider_message_id is not null and status <> 'sent');
```

Poté v aplikaci otevřete Nastavení → Stav služeb. Kontrola databáze musí zobrazit, že auditní schéma je připravené.

## Produkční provoz

- Bucket `invoice-documents` musí zůstat privátní.
- Zapněte zálohy a obnovu do bodu v čase podle zvoleného tarifu Supabase.
- Změny schématu provádějte novou migrací; neupravujte již použitou migraci.
- Pravidelně kontrolujte neúspěšné záznamy v `reminder_log` a poslední stav v `reminder_automation_runs`.
- Sledujte neúspěšné OCR stavy v `invoice_uploads`, dobu zpracování serverových funkcí a adresy v `email_suppressions`.
- Po každém importu banky zkontrolujte počet nespárovaných a nejednoznačných položek.
- Nikdy nezapisujte API klíče, tokeny nebo obsah dokumentů do `invoice_events.details`.
