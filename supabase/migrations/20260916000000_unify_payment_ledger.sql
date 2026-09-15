-- Sjednocuje evidenci uhrad faktur do jedne zdroje pravdy.
--
-- Duvod: GPC import (bank_payment_allocations) umi rozdelit jednu platbu
-- na vice faktur, ale zbytek systemu o tom nevedel:
--   1) commit_bank_statement_import u plne rozdelene platby (2+ faktury,
--      soucet = castka platby) nastavoval match_status='matched' s
--      invoice_id=null, coz porusuje bank_payments_match_consistency a
--      commit by u takove platby spadl na constraint violation.
--   2) delete_invoice_safely a reopen_paid_invoice odpojovaly jen
--      bank_payments.invoice_id (legacy 1:1 model), ale
--      bank_payment_allocations.invoice_id je "on delete restrict" -- smazani
--      faktury, ktera kdy prosla GPC parovanim, tak vzdy spadlo na FK chybu.
--   3) rucni "Potvrdit uhradu" vubec nezapisovalo do evidence plateb, takze
--      castecne sparovana faktura sla rucne "doplatit" beze stopy.

-- 1) Novy stav 'split': platba plne alokovana, ale na vice nez jednu fakturu.
--    'ambiguous' zustava vyhrazeny pro skutecne nejednoznacne/needokoncene
--    platby (cast alokace chybi, ceka na kontrolu).
alter table bank_payments drop constraint if exists bank_payments_match_consistency;
alter table bank_payments drop constraint if exists bank_payments_match_status_check;
alter table bank_payments add constraint bank_payments_match_status_check
  check (match_status in ('matched', 'split', 'unmatched', 'ambiguous'));
alter table bank_payments add constraint bank_payments_match_consistency check (
  (match_status = 'matched' and invoice_id is not null and matched_at is not null)
  or (match_status = 'split' and invoice_id is null and matched_at is not null)
  or (match_status in ('unmatched', 'ambiguous') and invoice_id is null)
);

-- 2) Puvod platby: bankovni import (GPC/CSV) vs. rucni potvrzeni na fakture.
alter table bank_payments add column if not exists source text not null default 'bank_import'
  check (source in ('bank_import', 'manual'));

-- 3) commit_bank_statement_import: opravit vypocet match_status/invoice_id
--    tak, aby plne rozdelena platba (2+ faktury) dostala 'split' misto
--    nedosazitelneho 'matched' s null invoice_id.
create or replace function public.commit_bank_statement_import(
  target_org uuid, actor_user uuid, target_import uuid, expected_revision integer, acknowledge_account_mismatch boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare selected_import public.bank_statement_imports%rowtype; invalid_count integer; imported_count integer; matched_count integer;
begin
  if not exists(select 1 from public.organization_members where organization_id=target_org and user_id=actor_user and role in('accounting','admin')) then
    raise exception 'insufficient_payment_import_permission';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  select * into selected_import from public.bank_statement_imports where id=target_import and organization_id=target_org for update;
  if not found then raise exception 'statement_import_not_found'; end if;
  if selected_import.status='committed' then
    return jsonb_build_object('id', selected_import.id, 'status', 'committed', 'idempotent', true);
  end if;
  if selected_import.status<>'review' then raise exception 'statement_import_not_committable'; end if;
  if selected_import.revision<>expected_revision then raise exception 'revision_conflict'; end if;
  if selected_import.account_mismatch and not acknowledge_account_mismatch then raise exception 'account_mismatch_acknowledgement_required'; end if;

  if exists(
    select 1 from public.bank_statement_entries entry
    where entry.import_id=target_import and entry.disposition='accepted'
    group by entry.external_id having entry.external_id is null or count(*)>1
  ) or exists(
    select 1 from public.bank_statement_entries entry
    join public.bank_payments payment on payment.organization_id=target_org and payment.external_id=entry.external_id
    where entry.import_id=target_import and entry.disposition='accepted'
  ) then raise exception 'duplicate_external_id'; end if;

  perform invoice.id from public.invoices invoice
  join public.bank_payment_allocations allocation on allocation.invoice_id=invoice.id
  join public.bank_statement_entries entry on entry.id=allocation.statement_entry_id
  where entry.import_id=target_import and allocation.is_committed=false order by invoice.id for update of invoice;

  select count(*) into invalid_count from (
    select entry.id
    from public.bank_statement_entries entry
    left join public.bank_payment_allocations allocation on allocation.statement_entry_id=entry.id and allocation.is_committed=false
    left join public.invoices invoice on invoice.id=allocation.invoice_id
    where entry.import_id=target_import and entry.disposition='accepted'
    group by entry.id, entry.amount, entry.currency
    having coalesce(sum(allocation.amount),0) > entry.amount
      or bool_or(allocation.id is not null and invoice.organization_id is distinct from target_org)
      or bool_or(allocation.id is not null and invoice.currency is distinct from entry.currency)
      or bool_or(allocation.id is not null and allocation.amount > invoice.amount-invoice.paid_amount)
      or (coalesce(sum(allocation.amount),0) <> entry.amount and not coalesce(bool_or(allocation.is_manual_partial),false) and count(allocation.id)>0)
  ) invalid;
  if invalid_count>0 then raise exception 'invalid_allocation_totals'; end if;
  select count(*) into invalid_count from (
    select allocation.invoice_id
    from public.bank_payment_allocations allocation
    join public.bank_statement_entries entry on entry.id=allocation.statement_entry_id
    join public.invoices invoice on invoice.id=allocation.invoice_id
    where entry.import_id=target_import and allocation.is_committed=false
    group by allocation.invoice_id, invoice.amount, invoice.paid_amount
    having sum(allocation.amount)>invoice.amount-invoice.paid_amount
  ) overallocated;
  if invalid_count>0 then raise exception 'invoice_overallocated'; end if;

  update public.bank_statement_imports set status='committing', updated_at=now() where id=target_import;
  insert into public.bank_payments(organization_id, invoice_id, external_id, booked_on, amount, currency, variable_symbol,
    counterparty_name, counterparty_account, note, match_status, source, imported_by, matched_at)
  select target_org,
    case when count(allocation.id)=1 and sum(allocation.amount)=entry.amount then (array_agg(allocation.invoice_id order by allocation.invoice_id))[1] else null end,
    entry.external_id, entry.booked_on, entry.amount, entry.currency, entry.variable_symbol, entry.counterparty_name,
    entry.counterparty_account, entry.note,
    case when count(allocation.id)=1 and sum(allocation.amount)=entry.amount then 'matched'
         when count(allocation.id)>1 and sum(allocation.amount)=entry.amount then 'split'
         when count(allocation.id)>0 then 'ambiguous' else 'unmatched' end,
    'bank_import',
    actor_user, case when count(allocation.id)>0 then now() else null end
  from public.bank_statement_entries entry
  left join public.bank_payment_allocations allocation on allocation.statement_entry_id=entry.id and allocation.is_committed=false
  where entry.import_id=target_import and entry.disposition='accepted'
  group by entry.id
  on conflict(organization_id, external_id) do nothing;

  update public.bank_statement_entries entry set bank_payment_id=payment.id
  from public.bank_payments payment where entry.import_id=target_import and payment.organization_id=target_org and payment.external_id=entry.external_id;
  update public.bank_payment_allocations allocation set bank_payment_id=entry.bank_payment_id, is_committed=true, committed_at=now()
  from public.bank_statement_entries entry where allocation.statement_entry_id=entry.id and entry.import_id=target_import and allocation.is_committed=false;

  insert into public.counterparty_payment_accounts(organization_id,counterparty_ico,account_number,confirmed_by)
  select distinct target_org, invoice.counterparty_ico, entry.counterparty_account, actor_user
  from public.bank_payment_allocations allocation
  join public.bank_statement_entries entry on entry.id=allocation.statement_entry_id
  join public.invoices invoice on invoice.id=allocation.invoice_id
  where entry.import_id=target_import and allocation.is_committed
    and nullif(trim(invoice.counterparty_ico),'') is not null and nullif(trim(entry.counterparty_account),'') is not null
  on conflict(organization_id,counterparty_ico,account_number) do update set last_used_at=now();

  with additions as (
    select allocation.invoice_id, sum(allocation.amount) amount, max(entry.booked_on) booked_on
    from public.bank_payment_allocations allocation join public.bank_statement_entries entry on entry.id=allocation.statement_entry_id
    where entry.import_id=target_import and allocation.is_committed group by allocation.invoice_id
  )
  update public.invoices invoice set paid_amount=invoice.paid_amount+additions.amount,
    status=case when invoice.paid_amount+additions.amount=invoice.amount then 'paid'
      when invoice.due_date<(now() at time zone 'Europe/Prague')::date then 'overdue' else 'pending' end,
    paid_at=case when invoice.paid_amount+additions.amount=invoice.amount then (additions.booked_on+time '12:00') at time zone 'Europe/Prague' else null end,
    next_reminder_at=case when invoice.paid_amount+additions.amount=invoice.amount then null else invoice.next_reminder_at end,
    updated_by=actor_user, updated_at=now()
  from additions where invoice.id=additions.invoice_id and invoice.organization_id=target_org;

  select count(*) into imported_count from public.bank_statement_entries where import_id=target_import and disposition='accepted' and bank_payment_id is not null;
  select count(distinct statement_entry_id) into matched_count from public.bank_payment_allocations allocation
    join public.bank_statement_entries entry on entry.id=allocation.statement_entry_id where entry.import_id=target_import and allocation.is_committed;
  update public.bank_statement_imports set status='committed', revision=revision+1,
    account_mismatch_acknowledged=account_mismatch and acknowledge_account_mismatch,
    committed_by=actor_user, committed_at=now(), updated_at=now() where id=target_import;
  return jsonb_build_object('id',target_import,'status','committed','imported',imported_count,'matched',matched_count,'idempotent',false);
end $$;

-- 4) delete_invoice_safely: predtim se odpojoval jen legacy bank_payments.
--    bank_payment_allocations.invoice_id je "on delete restrict", takze
--    kazda faktura kdy dotcena GPC parovanim smazani padala na FK chybu.
--    Nejdriv se odpoji legacy 1:1 platby (spoustovy trigger sam uklidi
--    jejich alokaci), pak se rucne uklidi zbyvajici (rozdelene/split)
--    alokace, ktere trigger nechyta, protoze bank_payments.invoice_id je
--    u nich null.
create or replace function delete_invoice_safely(
  target_org uuid,
  target_invoice uuid,
  actor_user uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_invoice invoices%rowtype;
  detached_payments integer := 0;
  affected_payment record;
  remaining_count integer;
  remaining_sum numeric;
  remaining_invoice uuid;
begin
  if not exists (
    select 1 from organization_members
    where organization_id = target_org
      and user_id = actor_user
      and role in ('accounting', 'admin')
  ) then
    raise exception 'insufficient_permission';
  end if;

  select * into selected_invoice
  from invoices
  where id = target_invoice and organization_id = target_org
  for update;

  if selected_invoice.id is null then
    raise exception 'invoice_not_found';
  end if;

  -- Legacy 1:1 shoda: spoustovy trigger bank_payments_sync_legacy_allocation
  -- sam odstrani odpovidajici radek v bank_payment_allocations.
  update bank_payments
  set invoice_id = null,
      match_status = 'unmatched',
      matched_at = null,
      unmatched_at = now(),
      unmatched_by = actor_user
  where organization_id = target_org
    and invoice_id = target_invoice;
  get diagnostics detached_payments = row_count;

  -- Zbyle (rozdelene/split, nebo jeste neuzavrene) alokace odkazujici na tuto
  -- fakturu, ktere legacy update vyse nezachytil (bank_payments.invoice_id
  -- je u nich null).
  delete from bank_payment_allocations
  where organization_id = target_org and invoice_id = target_invoice and not is_committed;

  for affected_payment in
    select distinct bank_payment_id from bank_payment_allocations
    where organization_id = target_org and invoice_id = target_invoice
      and is_committed and bank_payment_id is not null
  loop
    delete from bank_payment_allocations
    where organization_id = target_org and invoice_id = target_invoice
      and bank_payment_id = affected_payment.bank_payment_id and is_committed;
    detached_payments := detached_payments + 1;

    select count(*), coalesce(sum(amount), 0)
      into remaining_count, remaining_sum
    from bank_payment_allocations
    where bank_payment_id = affected_payment.bank_payment_id and is_committed;

    if remaining_count = 0 then
      update bank_payments set invoice_id = null, match_status = 'unmatched', matched_at = null,
        unmatched_at = now(), unmatched_by = actor_user
      where id = affected_payment.bank_payment_id;
    elsif remaining_count = 1 and remaining_sum = (select amount from bank_payments where id = affected_payment.bank_payment_id) then
      select invoice_id into remaining_invoice from bank_payment_allocations
      where bank_payment_id = affected_payment.bank_payment_id and is_committed limit 1;
      update bank_payments set invoice_id = remaining_invoice, match_status = 'matched'
      where id = affected_payment.bank_payment_id;
    elsif remaining_sum = (select amount from bank_payments where id = affected_payment.bank_payment_id) then
      update bank_payments set invoice_id = null, match_status = 'split'
      where id = affected_payment.bank_payment_id;
    else
      update bank_payments set invoice_id = null, match_status = 'ambiguous'
      where id = affected_payment.bank_payment_id;
    end if;
  end loop;

  delete from invoices
  where id = target_invoice and organization_id = target_org;

  return jsonb_build_object(
    'invoice_id', target_invoice,
    'file_url', selected_invoice.file_url,
    'detached_payments', detached_payments
  );
end;
$$;

-- 5) reopen_paid_invoice: stejny problem jako u delete_invoice_safely -- ted
--    take uklidi zbyvajici (split) alokace teto faktury, ne jen legacy
--    bank_payments.invoice_id.
create or replace function reopen_paid_invoice(
  target_org uuid,
  target_invoice uuid,
  actor_user uuid,
  new_status text,
  next_time timestamptz
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  selected_invoice invoices%rowtype;
  reopened_invoice invoices%rowtype;
  detached_count integer := 0;
  affected_payment record;
  remaining_count integer;
  remaining_sum numeric;
  remaining_invoice uuid;
begin
  if not exists (
    select 1 from organization_members
    where organization_id = target_org and user_id = actor_user and role in ('accounting', 'admin')
  ) then raise exception 'insufficient_permission'; end if;
  if new_status not in ('pending', 'overdue') then raise exception 'invalid_reopen_status'; end if;

  select * into selected_invoice from invoices
  where id = target_invoice and organization_id = target_org for update;
  if not found then raise exception 'invoice_not_found'; end if;
  if selected_invoice.status <> 'paid' then raise exception 'invoice_not_paid'; end if;

  update bank_payments set
    invoice_id = null,
    match_status = 'unmatched',
    matched_at = null,
    unmatched_at = now(),
    unmatched_by = actor_user
  where organization_id = target_org and invoice_id = target_invoice and match_status = 'matched';
  get diagnostics detached_count = row_count;

  for affected_payment in
    select distinct bank_payment_id from bank_payment_allocations
    where organization_id = target_org and invoice_id = target_invoice
      and is_committed and bank_payment_id is not null
  loop
    delete from bank_payment_allocations
    where organization_id = target_org and invoice_id = target_invoice
      and bank_payment_id = affected_payment.bank_payment_id and is_committed;
    detached_count := detached_count + 1;

    select count(*), coalesce(sum(amount), 0)
      into remaining_count, remaining_sum
    from bank_payment_allocations
    where bank_payment_id = affected_payment.bank_payment_id and is_committed;

    if remaining_count = 0 then
      update bank_payments set invoice_id = null, match_status = 'unmatched', matched_at = null,
        unmatched_at = now(), unmatched_by = actor_user
      where id = affected_payment.bank_payment_id;
    elsif remaining_count = 1 and remaining_sum = (select amount from bank_payments where id = affected_payment.bank_payment_id) then
      select invoice_id into remaining_invoice from bank_payment_allocations
      where bank_payment_id = affected_payment.bank_payment_id and is_committed limit 1;
      update bank_payments set invoice_id = remaining_invoice, match_status = 'matched'
      where id = affected_payment.bank_payment_id;
    elsif remaining_sum = (select amount from bank_payments where id = affected_payment.bank_payment_id) then
      update bank_payments set invoice_id = null, match_status = 'split'
      where id = affected_payment.bank_payment_id;
    else
      update bank_payments set invoice_id = null, match_status = 'ambiguous'
      where id = affected_payment.bank_payment_id;
    end if;
  end loop;

  update invoices set
    status = new_status,
    paid_amount = 0,
    paid_at = null,
    next_reminder_at = next_time,
    updated_by = actor_user,
    updated_at = now()
  where id = target_invoice and organization_id = target_org
  returning * into reopened_invoice;

  update reminder_log set
    status = 'failed',
    error_message = 'Faktura byla znovu otevřena; krok čeká na nové vyhodnocení.',
    updated_at = now()
  where invoice_id = target_invoice and status = 'skipped' and sent_at is null;

  update invoice_events set details = details || jsonb_build_object(
    'paid_at', selected_invoice.paid_at,
    'detached_payments', detached_count
  ) where id = (
    select id from invoice_events
    where invoice_id = target_invoice and event_type = 'reopened'
    order by created_at desc limit 1
  );

  return jsonb_build_object('invoice', to_jsonb(reopened_invoice), 'detached_payments', detached_count);
end;
$$;

-- 6) Rucni potvrzeni uhrady jako radek ve stejne evidenci plateb jako
--    bankovni parovani -- misto primeho prepisu invoices.paid_amount.
--    Volajici (API) predava vyrovnavanou castku (typicky zbyvajici zustatek).
create or replace function confirm_manual_payment(
  target_org uuid,
  target_invoice uuid,
  actor_user uuid,
  payment_amount numeric,
  paid_on date
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  selected_invoice invoices%rowtype;
  new_paid_amount numeric;
  new_payment_id uuid;
begin
  if not exists (
    select 1 from organization_members
    where organization_id = target_org and user_id = actor_user and role in ('accounting', 'admin')
  ) then
    raise exception 'insufficient_permission';
  end if;
  if payment_amount is null or payment_amount <= 0 then
    raise exception 'invalid_payment_amount';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));

  select * into selected_invoice from invoices
  where id = target_invoice and organization_id = target_org and status in ('pending', 'overdue')
  for update;
  if not found then raise exception 'invoice_not_available_for_confirmation'; end if;

  if payment_amount > (selected_invoice.amount - selected_invoice.paid_amount) then
    raise exception 'payment_exceeds_remaining_amount';
  end if;

  new_paid_amount := selected_invoice.paid_amount + payment_amount;

  insert into bank_payments (
    organization_id, invoice_id, external_id, booked_on, amount, currency,
    match_status, source, imported_by, matched_at
  ) values (
    target_org, target_invoice, 'manual:' || gen_random_uuid()::text, coalesce(paid_on, (now() at time zone 'Europe/Prague')::date),
    payment_amount, selected_invoice.currency, 'matched', 'manual', actor_user, now()
  ) returning id into new_payment_id;

  insert into bank_payment_allocations (
    organization_id, bank_payment_id, invoice_id, amount, is_committed, created_by, committed_at
  ) values (
    target_org, new_payment_id, target_invoice, payment_amount, true, actor_user, now()
  );

  update invoices set
    paid_amount = new_paid_amount,
    status = case when new_paid_amount = amount then 'paid'
      when due_date < (now() at time zone 'Europe/Prague')::date then 'overdue' else 'pending' end,
    paid_at = case when new_paid_amount = amount then (coalesce(paid_on, (now() at time zone 'Europe/Prague')::date) + time '12:00') at time zone 'Europe/Prague' else null end,
    next_reminder_at = case when new_paid_amount = amount then null else next_reminder_at end,
    updated_by = actor_user, updated_at = now()
  where id = selected_invoice.id;

  return jsonb_build_object(
    'payment_id', new_payment_id, 'invoice_id', selected_invoice.id,
    'invoice_number', selected_invoice.invoice_number,
    'settlement', case when new_paid_amount = selected_invoice.amount then 'full' else 'partial' end,
    'paid_amount', new_paid_amount, 'remaining', selected_invoice.amount - new_paid_amount,
    'invoice_status', case when new_paid_amount = selected_invoice.amount then 'paid'
      when selected_invoice.due_date < (now() at time zone 'Europe/Prague')::date then 'overdue' else 'pending' end
  );
end;
$$;

revoke all on function confirm_manual_payment(uuid, uuid, uuid, numeric, date) from public, anon, authenticated;
grant execute on function confirm_manual_payment(uuid, uuid, uuid, numeric, date) to service_role;
