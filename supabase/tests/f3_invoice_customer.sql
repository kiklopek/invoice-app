\set ON_ERROR_STOP on
-- Fáze F3 přestavby databáze (expand): stav upomínek a dokument mají vlastní
-- tabulky, vše o odběrateli odkazuje na customers.id. Staré sloupce zůstávají
-- a nové tabulky se s nimi drží triggerem; aplikace se nemění.
begin;
do $$
declare
  org uuid := '00000000-0000-4000-8000-0000000003f1';
  admin uuid := '00000000-0000-4000-8000-0000000003f2';
  policy uuid; inv uuid; cust uuid; n integer;
begin
  foreach n in array array[1] loop
    if to_regclass('public.invoice_reminder_state') is null or to_regclass('public.invoice_documents') is null
      or to_regclass('public.invoice_list_v') is null or to_regclass('public.ocr_jobs') is null then
      raise exception 'F3 objects are missing';
    end if;
  end loop;
  for n in select 1 from (values ('counterparty_payment_accounts'), ('counterparty_reminder_preferences'), ('payment_payer_memory')) t(name)
    where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t.name and column_name = 'customer_id') loop
    raise exception 'customer_id missing on a counterparty table';
  end loop;
  if has_table_privilege('authenticated', 'public.invoice_list_v', 'SELECT') or has_table_privilege('anon', 'public.invoice_reminder_state', 'SELECT') then
    raise exception 'client roles can read F3 objects';
  end if;

  insert into auth.users(id, email) values (admin, 'f3-admin@example.invalid');
  insert into public.organizations(id, name, ico) values (org, 'F3 test s.r.o.', '27074358');
  insert into public.organization_members(organization_id, user_id, email, role) values (org, admin, 'f3-admin@example.invalid', 'admin');
  insert into public.subscriptions(organization_id, status, plan, period, billing_exempt) values (org, 'active', 'business', 'yearly', true);

  insert into public.invoices(organization_id, invoice_number, counterparty_name, counterparty_ico, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by, file_url)
  values (org, 'F3-1', 'Odběratel a.s.', '45274649', 'o@example.invalid', 100, 0, 100, 'CZK', current_date, current_date + 14, 'pending', admin, 'org/f3-1.pdf')
  returning id, customer_id into inv, cust;
  if cust is null then raise exception 'invoice with IČO got no customer'; end if;

  -- 1. Stav upomínek žije i ve vlastní tabulce a drží krok s fakturou.
  if not exists (select 1 from public.invoice_reminder_state where invoice_id = inv and organization_id = org and reminders_sent = 0 and not paused) then
    raise exception 'reminder state row missing for a new invoice';
  end if;
  update public.invoices set reminders_sent = 2, last_reminder_at = now(), reminders_paused = true, reminders_paused_at = now(), reminders_paused_by = admin where id = inv;
  if not exists (select 1 from public.invoice_reminder_state where invoice_id = inv and reminders_sent = 2 and paused and paused_by = admin) then
    raise exception 'reminder state did not follow the invoice';
  end if;
  select count(*) into n from public.invoices i left join public.invoice_reminder_state s on s.invoice_id = i.id
  where s.invoice_id is null or s.reminders_sent <> i.reminders_sent or s.paused <> i.reminders_paused
    or s.next_reminder_at is distinct from i.next_reminder_at or s.last_reminder_at is distinct from i.last_reminder_at;
  if n > 0 then raise exception '% invoices disagree with invoice_reminder_state', n; end if;

  -- 2. Dokument má vlastní záznam a každá změna souboru je nová verze.
  if not exists (select 1 from public.invoice_documents where invoice_id = inv and storage_path = 'org/f3-1.pdf' and is_current) then
    raise exception 'document row missing';
  end if;
  update public.invoices set file_url = 'org/f3-1-v2.pdf' where id = inv;
  if (select count(*) from public.invoice_documents where invoice_id = inv) <> 2
    or (select storage_path from public.invoice_documents where invoice_id = inv and is_current) <> 'org/f3-1-v2.pdf' then
    raise exception 'document versions wrong';
  end if;

  -- 3. Paměť odběratele odkazuje na customers.id.
  insert into public.counterparty_payment_accounts(organization_id, counterparty_ico, account_number, confirmed_by)
    values (org, '45274649', '19-2000145399/0800', admin);
  if (select customer_id from public.counterparty_payment_accounts where organization_id = org and counterparty_ico = '45274649') is distinct from cust then
    raise exception 'payment account not linked to the customer';
  end if;
  -- IČO bez odběratele se nepřiřadí naslepo ani se odběratel nezaloží.
  insert into public.counterparty_payment_accounts(organization_id, counterparty_ico, account_number, confirmed_by)
    values (org, '00000000', '2400000000/2010', admin);
  if (select customer_id from public.counterparty_payment_accounts where organization_id = org and counterparty_ico = '00000000') is not null then
    raise exception 'unknown IČO was linked to some customer';
  end if;
  if exists (select 1 from public.customers where organization_id = org and ico = '00000000') then
    raise exception 'customer was created silently';
  end if;

  -- 4. Seznam faktur skládá doklad, úhradu, upomínky a odběratele do jednoho řádku.
  if not exists (select 1 from public.invoice_list_v where id = inv and customer_name = 'Odběratel a.s.' and remaining = 100
      and payment_state = 'unpaid' and reminders_sent = 2 and reminders_paused) then
    raise exception 'invoice_list_v row wrong: %', (select to_jsonb(v) from public.invoice_list_v v where id = inv);
  end if;
end $$;
rollback;
