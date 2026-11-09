-- Fáze F2 přestavby databáze (expand): jedna účetní kniha plateb, stínový krok.
--
-- Zdrojem pravdy o přiřazení platby k faktuře jsou alokace
-- (bank_payment_allocations). Tahle migrace nic nepřepočítává a žádný stav
-- nemění; přidává:
--   * invoice_balances      – uhrazeno / zbývá / stav úhrady z alokací,
--   * bank_payment_balances – přiřazeno / nepřiřazeno / odvozený stav platby,
--   * hlídač, který na konci každé transakce porovná invoices.paid_amount
--     a starou vazbu bank_payments.invoice_id s alokacemi.
-- Do brány (2 týdny bez rozdílu) hlídač rozdíl jen zapíše do
-- money_guard_violations; pak ho contract migrace přepne na zastavení zápisu
-- (dnes jde vyzkoušet nastavením splatno.money_guard = 'enforce').

create view public.invoice_balances with (security_invoker = true) as
select i.id as invoice_id,
       i.organization_id,
       i.currency,
       i.amount,
       coalesce(a.allocated, 0)::numeric(14,2) as allocated,
       (i.amount - coalesce(a.allocated, 0))::numeric(14,2) as remaining,
       case
         when coalesce(a.allocated, 0) = 0 then 'unpaid'
         when coalesce(a.allocated, 0) < i.amount then 'partial'
         when coalesce(a.allocated, 0) = i.amount then 'paid'
         else 'overpaid'
       end as payment_state,
       a.last_allocated_at
from public.invoices i
left join (
  select invoice_id, sum(amount) as allocated, max(coalesce(committed_at, created_at)) as last_allocated_at
  from public.bank_payment_allocations
  where is_committed
  group by invoice_id
) a on a.invoice_id = i.id;

create view public.bank_payment_balances with (security_invoker = true) as
select p.id as bank_payment_id,
       p.organization_id,
       p.currency,
       p.amount,
       coalesce(a.allocated, 0)::numeric(14,2) as allocated,
       (p.amount - coalesce(a.allocated, 0))::numeric(14,2) as unallocated,
       coalesce(a.invoice_count, 0)::integer as invoice_count,
       case
         when coalesce(a.allocated, 0) = 0 then 'unmatched'
         when a.allocated > p.amount then 'over_allocated'
         when a.allocated < p.amount then 'partial'
         when a.invoice_count = 1 then 'matched'
         else 'split'
       end as derived_state,
       p.match_status as legacy_match_status,
       p.invoice_id as legacy_invoice_id
from public.bank_payments p
left join (
  select bank_payment_id, sum(amount) as allocated, count(distinct invoice_id) as invoice_count
  from public.bank_payment_allocations
  where is_committed and bank_payment_id is not null
  group by bank_payment_id
) a on a.bank_payment_id = p.id;

revoke all on public.invoice_balances, public.bank_payment_balances from public, anon, authenticated;
grant select on public.invoice_balances, public.bank_payment_balances to service_role;

create table public.money_guard_violations (
  id bigint generated always as identity primary key,
  organization_id uuid,
  kind text not null check (kind in ('paid_amount_mismatch', 'legacy_link_without_allocation', 'payment_over_allocated')),
  entity_id uuid not null,
  expected numeric(14,2),
  actual numeric(14,2),
  details jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now()
);
create index money_guard_violations_recent on public.money_guard_violations (organization_id, recorded_at desc);
alter table public.money_guard_violations enable row level security;
revoke all on public.money_guard_violations from public, anon, authenticated;
grant select on public.money_guard_violations to service_role;

create or replace function private.money_guard_report(org uuid, violation text, entity uuid, expected_value numeric, actual_value numeric, info jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(nullif(current_setting('splatno.money_guard', true), ''), 'log') = 'enforce' then
    raise exception '%', violation using detail = format('entity %s expected %s actual %s', entity, expected_value, actual_value);
  end if;
  insert into public.money_guard_violations (organization_id, kind, entity_id, expected, actual, details)
  values (org, violation, entity, expected_value, actual_value, coalesce(info, '{}'::jsonb));
end $$;

create or replace function private.money_guard_invoice(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  inv record;
  committed numeric;
begin
  select id, organization_id, paid_amount into inv from public.invoices where id = target;
  if inv.id is null then return; end if;
  select coalesce(sum(amount), 0) into committed
  from public.bank_payment_allocations where invoice_id = target and is_committed;
  if committed <> inv.paid_amount then
    perform private.money_guard_report(inv.organization_id, 'paid_amount_mismatch', target, committed, inv.paid_amount, '{}'::jsonb);
  end if;
end $$;

create or replace function private.money_guard_payment(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  pay record;
  committed numeric;
begin
  select id, organization_id, amount, invoice_id into pay from public.bank_payments where id = target;
  if pay.id is null then return; end if;
  select coalesce(sum(amount), 0) into committed
  from public.bank_payment_allocations where bank_payment_id = target and is_committed;
  if committed > pay.amount then
    perform private.money_guard_report(pay.organization_id, 'payment_over_allocated', target, pay.amount, committed, '{}'::jsonb);
  end if;
  if pay.invoice_id is not null and not exists (
    select 1 from public.bank_payment_allocations
    where bank_payment_id = target and invoice_id = pay.invoice_id and is_committed
  ) then
    perform private.money_guard_report(pay.organization_id, 'legacy_link_without_allocation', target, null, null,
      jsonb_build_object('invoice_id', pay.invoice_id));
  end if;
end $$;

create or replace function private.money_guard_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'invoices' then
    perform private.money_guard_invoice(new.id);
  elsif tg_table_name = 'bank_payments' then
    perform private.money_guard_payment(new.id);
  else
    if tg_op <> 'INSERT' then
      perform private.money_guard_invoice(old.invoice_id);
      if old.bank_payment_id is not null then perform private.money_guard_payment(old.bank_payment_id); end if;
    end if;
    if tg_op <> 'DELETE' then
      if tg_op = 'INSERT' or new.invoice_id is distinct from old.invoice_id then perform private.money_guard_invoice(new.invoice_id); end if;
      if new.bank_payment_id is not null and (tg_op = 'INSERT' or new.bank_payment_id is distinct from old.bank_payment_id) then
        perform private.money_guard_payment(new.bank_payment_id);
      end if;
    end if;
  end if;
  return null;
end $$;

revoke all on function private.money_guard_report(uuid, text, uuid, numeric, numeric, jsonb) from public, anon, authenticated;
revoke all on function private.money_guard_invoice(uuid) from public, anon, authenticated;
revoke all on function private.money_guard_payment(uuid) from public, anon, authenticated;
revoke all on function private.money_guard_trigger() from public, anon, authenticated;

-- Kontrola běží až při potvrzení transakce: funkce párování smí během ní
-- zapsat alokaci a paid_amount v libovolném pořadí.
-- Události se zařadí jen při skutečné změně peněžní hodnoty, aby běžný zápis
-- faktury nenechal ve frontě odloženou kontrolu (ta by blokovala ALTER TABLE
-- ve stejné transakci, např. v pozdější migraci).
-- Migrace, která mění peníze a pak ALTER TABLE invoices / bank_payments /
-- bank_payment_allocations, musí před ALTER zavolat `set constraints all immediate`.
create constraint trigger money_guard_invoice after update of paid_amount on public.invoices
  deferrable initially deferred for each row
  when (old.paid_amount is distinct from new.paid_amount)
  execute function private.money_guard_trigger();
create constraint trigger money_guard_invoice_insert after insert on public.invoices
  deferrable initially deferred for each row
  when (new.paid_amount <> 0)
  execute function private.money_guard_trigger();
create constraint trigger money_guard_payment after update of invoice_id, amount on public.bank_payments
  deferrable initially deferred for each row
  when (old.invoice_id is distinct from new.invoice_id or old.amount is distinct from new.amount)
  execute function private.money_guard_trigger();
create constraint trigger money_guard_payment_insert after insert on public.bank_payments
  deferrable initially deferred for each row
  when (new.invoice_id is not null)
  execute function private.money_guard_trigger();
create constraint trigger money_guard_allocation after insert or update or delete on public.bank_payment_allocations
  deferrable initially deferred for each row execute function private.money_guard_trigger();
