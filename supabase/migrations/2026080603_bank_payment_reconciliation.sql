-- Přijaté bankovní platby a atomické párování na otevřené faktury.
create table if not exists bank_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null,
  external_id text not null check (length(trim(external_id)) between 1 and 120),
  booked_on date not null,
  amount numeric(14,2) not null check (amount > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  variable_symbol text check (variable_symbol is null or (length(variable_symbol) <= 20 and variable_symbol ~ '^[0-9]+$')),
  counterparty_name text check (counterparty_name is null or length(counterparty_name) <= 200),
  counterparty_account text check (counterparty_account is null or length(counterparty_account) <= 100),
  note text check (note is null or length(note) <= 500),
  match_status text not null default 'unmatched' check (match_status in ('matched', 'unmatched', 'ambiguous')),
  imported_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  matched_at timestamptz,
  unique (organization_id, external_id)
);

create index if not exists bank_payments_review on bank_payments (organization_id, match_status, booked_on desc);
create index if not exists bank_payments_invoice on bank_payments (invoice_id, booked_on desc);

create or replace function import_and_reconcile_bank_payments(
  target_org uuid, actor_user uuid, payment_rows jsonb
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  payment jsonb; payment_id uuid; candidate_id uuid; candidate_number text; candidate_count integer;
  imported_count integer := 0; matched_count integer := 0; unmatched_count integer := 0;
  ambiguous_count integer := 0; duplicate_count integer := 0; results jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(payment_rows) <> 'array' or jsonb_array_length(payment_rows) < 1 or jsonb_array_length(payment_rows) > 500 then
    raise exception 'invalid payment batch';
  end if;
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user and role in ('accounting', 'admin')) then
    raise exception 'insufficient payment import permission';
  end if;
  for payment in select value from jsonb_array_elements(payment_rows) loop
    payment_id := null; candidate_id := null; candidate_number := null; candidate_count := 0;
    insert into bank_payments (organization_id, external_id, booked_on, amount, currency, variable_symbol, counterparty_name, counterparty_account, note, imported_by)
    values (target_org, trim(payment ->> 'external_id'), (payment ->> 'booked_on')::date, (payment ->> 'amount')::numeric,
      upper(payment ->> 'currency'), nullif(trim(payment ->> 'variable_symbol'), ''), nullif(trim(payment ->> 'counterparty_name'), ''),
      nullif(trim(payment ->> 'counterparty_account'), ''), nullif(trim(payment ->> 'note'), ''), actor_user)
    on conflict (organization_id, external_id) do nothing returning id into payment_id;
    if payment_id is null then
      duplicate_count := duplicate_count + 1;
      results := results || jsonb_build_array(jsonb_build_object('external_id', payment ->> 'external_id', 'status', 'duplicate'));
      continue;
    end if;
    imported_count := imported_count + 1;
    if nullif(trim(payment ->> 'variable_symbol'), '') is not null then
      select count(*), (array_agg(id order by id))[1], (array_agg(invoice_number order by id))[1] into candidate_count, candidate_id, candidate_number from invoices
      where organization_id = target_org and status in ('pending', 'overdue') and variable_symbol = trim(payment ->> 'variable_symbol')
        and currency = upper(payment ->> 'currency') and amount = (payment ->> 'amount')::numeric;
    end if;
    if candidate_count = 1 then
      update bank_payments set invoice_id = candidate_id, match_status = 'matched', matched_at = now() where id = payment_id;
      update invoices set status = 'paid', paid_at = ((payment ->> 'booked_on')::date + time '12:00') at time zone 'Europe/Prague',
        next_reminder_at = null, updated_by = actor_user, updated_at = now()
      where id = candidate_id and organization_id = target_org and status in ('pending', 'overdue');
      matched_count := matched_count + 1;
      results := results || jsonb_build_array(jsonb_build_object('external_id', payment ->> 'external_id', 'status', 'matched', 'invoice_id', candidate_id, 'invoice_number', candidate_number));
    elsif candidate_count > 1 then
      update bank_payments set match_status = 'ambiguous' where id = payment_id;
      ambiguous_count := ambiguous_count + 1;
      results := results || jsonb_build_array(jsonb_build_object('external_id', payment ->> 'external_id', 'status', 'ambiguous'));
    else
      unmatched_count := unmatched_count + 1;
      results := results || jsonb_build_array(jsonb_build_object('external_id', payment ->> 'external_id', 'status', 'unmatched'));
    end if;
  end loop;
  return jsonb_build_object('imported', imported_count, 'matched', matched_count, 'unmatched', unmatched_count,
    'ambiguous', ambiguous_count, 'duplicates', duplicate_count, 'results', results);
end;
$$;

revoke all on function import_and_reconcile_bank_payments(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function import_and_reconcile_bank_payments(uuid, uuid, jsonb) to service_role;

create or replace function assign_bank_payment(
  target_org uuid, target_payment uuid, target_invoice uuid, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare selected_payment bank_payments%rowtype; selected_invoice invoices%rowtype;
begin
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user and role in ('accounting', 'admin')) then
    raise exception 'insufficient payment assignment permission';
  end if;
  select * into selected_payment from bank_payments
  where id = target_payment and organization_id = target_org and match_status in ('unmatched', 'ambiguous') for update;
  if not found then raise exception 'payment is not available for assignment'; end if;
  select * into selected_invoice from invoices
  where id = target_invoice and organization_id = target_org and status in ('pending', 'overdue') for update;
  if not found then raise exception 'invoice is not available for assignment'; end if;
  if selected_payment.amount <> selected_invoice.amount or selected_payment.currency <> selected_invoice.currency then
    raise exception 'payment amount or currency does not match invoice';
  end if;
  update bank_payments set invoice_id = selected_invoice.id, match_status = 'matched', matched_at = now() where id = selected_payment.id;
  update invoices set status = 'paid', paid_at = (selected_payment.booked_on + time '12:00') at time zone 'Europe/Prague',
    next_reminder_at = null, updated_by = actor_user, updated_at = now() where id = selected_invoice.id;
  return jsonb_build_object('payment_id', selected_payment.id, 'invoice_id', selected_invoice.id,
    'invoice_number', selected_invoice.invoice_number, 'status', 'matched');
end;
$$;

revoke all on function assign_bank_payment(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function assign_bank_payment(uuid, uuid, uuid, uuid) to service_role;
alter table bank_payments enable row level security;
revoke insert, update, delete on bank_payments from anon, authenticated;
drop policy if exists "members can view bank payments" on bank_payments;
create policy "members can view bank payments" on bank_payments for select using (is_org_member(organization_id));
