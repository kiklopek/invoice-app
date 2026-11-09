\set ON_ERROR_STOP on
-- Fáze F2 přestavby databáze (expand): stav úhrady a stav platby se odvozují
-- z alokací a každý zápis, po kterém by se staré sloupce s alokacemi rozešly,
-- se zachytí. Do brány se rozdíl jen zapíše; v režimu enforce zápis selže.
begin;
do $$
declare
  org uuid := '00000000-0000-4000-8000-0000000002f1';
  admin uuid := '00000000-0000-4000-8000-0000000002f2';
  inv uuid; pay uuid; failed text; n integer;
begin
  if to_regclass('public.invoice_balances') is null or to_regclass('public.bank_payment_balances') is null
    or to_regclass('public.money_guard_violations') is null then
    raise exception 'F2 ledger objects are missing';
  end if;
  if has_table_privilege('authenticated', 'public.invoice_balances', 'SELECT') or has_table_privilege('anon', 'public.invoice_balances', 'SELECT')
    or has_table_privilege('authenticated', 'public.money_guard_violations', 'SELECT') then
    raise exception 'client roles can read the ledger views';
  end if;

  insert into auth.users(id, email) values (admin, 'ledger-admin@example.invalid');
  insert into public.organizations(id, name, ico) values (org, 'Ledger test s.r.o.', '27074358');
  insert into public.organization_members(organization_id, user_id, email, role) values (org, admin, 'ledger-admin@example.invalid', 'admin');
  insert into public.subscriptions(organization_id, status, plan, period, billing_exempt) values (org, 'active', 'business', 'yearly', true);
  insert into public.invoices(organization_id, invoice_number, counterparty_name, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by)
  values (org, 'L-1', 'Odběratel', 'o@example.invalid', 100, 0, 100, 'CZK', current_date, current_date + 14, 'pending', admin)
  returning id into inv;

  -- 1. Pohled sedí s uloženou paid_amount u každé faktury.
  select count(*) into n from public.invoices i join public.invoice_balances b on b.invoice_id = i.id
  where b.allocated <> i.paid_amount or b.remaining <> i.amount - b.allocated;
  if n > 0 then raise exception '% invoices disagree with invoice_balances', n; end if;
  if (select payment_state from public.invoice_balances where invoice_id = inv) <> 'unpaid' then
    raise exception 'new invoice is not unpaid';
  end if;

  -- 2. Řádná úhrada: platba + alokace + paid_amount v jedné transakci.
  insert into public.bank_payments(organization_id, external_id, booked_on, amount, currency, match_status)
    values (org, 'LEDGER-1', current_date, 60, 'CZK', 'unmatched') returning id into pay;
  insert into public.bank_payment_allocations(organization_id, bank_payment_id, invoice_id, amount, is_committed, created_by, committed_at)
    values (org, pay, inv, 60, true, admin, now());
  update public.invoices set paid_amount = 60 where id = inv;
  set constraints all immediate;
  set constraints all deferred;
  if exists (select 1 from public.money_guard_violations where organization_id = org) then
    raise exception 'consistent payment was reported: %', (select jsonb_agg(v) from public.money_guard_violations v where organization_id = org);
  end if;
  if (select (payment_state, allocated, remaining) from public.invoice_balances where invoice_id = inv) <> ('partial'::text, 60::numeric, 40::numeric) then
    raise exception 'partial payment state wrong';
  end if;
  if (select (derived_state, unallocated) from public.bank_payment_balances where bank_payment_id = pay) <> ('matched'::text, 0::numeric) then
    raise exception 'payment state wrong: %', (select to_jsonb(b) from public.bank_payment_balances b where bank_payment_id = pay);
  end if;

  -- 3. paid_amount změněná bez alokace se zachytí (režim brány: zápis + pokračuje).
  update public.invoices set paid_amount = 80 where id = inv;
  set constraints all immediate;
  set constraints all deferred;
  if not exists (select 1 from public.money_guard_violations where organization_id = org and kind = 'paid_amount_mismatch'
      and entity_id = inv and expected = 60 and actual = 80) then
    raise exception 'paid_amount without allocation was not reported';
  end if;
  update public.invoices set paid_amount = 60 where id = inv;

  -- 4. V režimu enforce rozdíl zápis zastaví.
  perform set_config('splatno.money_guard', 'enforce', true);
  failed := null;
  begin
    update public.invoices set paid_amount = 90 where id = inv;
    set constraints all immediate;
  exception when others then failed := sqlerrm;
  end;
  if failed is distinct from 'paid_amount_mismatch' then raise exception 'enforce mode let a mismatch through: %', failed; end if;
  set constraints all deferred;
end $$;
rollback;
