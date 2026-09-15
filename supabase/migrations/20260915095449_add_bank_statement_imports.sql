-- Additive bank statement staging and allocation model. Existing CSV import and
-- bank_payments.invoice_id remain available for backwards compatibility.
create extension if not exists pg_trgm with schema extensions;

alter table public.organizations add column if not exists settings_revision integer not null default 1 check(settings_revision > 0);

create table public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_format text not null check (source_format in ('gpc', 'csv')),
  original_filename text not null check (length(original_filename) between 1 and 255),
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  storage_path text check (storage_path is null or length(storage_path) <= 500),
  statement_account text,
  period_from date,
  period_to date,
  status text not null default 'review' check (status in ('review', 'committing', 'committed', 'failed')),
  revision integer not null default 1 check (revision > 0),
  account_mismatch boolean not null default false,
  account_mismatch_acknowledged boolean not null default false,
  entry_count integer not null default 0 check (entry_count between 0 and 10000),
  accepted_count integer not null default 0 check (accepted_count between 0 and 10000),
  ignored_count integer not null default 0 check (ignored_count between 0 and 10000),
  error_count integer not null default 0 check (error_count between 0 and 10000),
  created_by uuid not null references auth.users(id),
  committed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  committed_at timestamptz,
  failure_reason text,
  unique (organization_id, file_hash)
);

create table public.bank_statement_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_id uuid not null references public.bank_statement_imports(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  record_type text not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  disposition text not null check (disposition in ('accepted', 'ignored', 'error', 'duplicate')),
  reason text,
  external_id text,
  booked_on date,
  amount numeric(14,2),
  currency char(3),
  variable_symbol text,
  counterparty_name text,
  counterparty_account text,
  note text,
  proposal_kind text check (proposal_kind is null or proposal_kind in ('exact', 'combination', 'account_suggestion', 'ambiguous', 'manual')),
  proposal_confidence text check (proposal_confidence is null or proposal_confidence in ('safe', 'review')),
  proposal_reason text,
  proposed_invoice_ids uuid[] not null default '{}',
  bank_payment_id uuid references public.bank_payments(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (import_id, line_number)
);

create table public.bank_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  statement_entry_id uuid references public.bank_statement_entries(id) on delete cascade,
  bank_payment_id uuid references public.bank_payments(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  is_manual_partial boolean not null default false,
  is_committed boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  check (statement_entry_id is not null or bank_payment_id is not null)
);

create unique index bank_payment_allocations_entry_invoice
  on public.bank_payment_allocations(statement_entry_id, invoice_id) where statement_entry_id is not null;
create unique index bank_payment_allocations_payment_invoice
  on public.bank_payment_allocations(bank_payment_id, invoice_id) where bank_payment_id is not null and is_committed;

create table public.counterparty_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  counterparty_ico text not null check (length(counterparty_ico) between 1 and 20),
  account_number text not null check (length(account_number) between 1 and 100),
  confirmed_by uuid not null references auth.users(id),
  confirmed_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (organization_id, counterparty_ico, account_number)
);

create index bank_statement_imports_archive on public.bank_statement_imports(organization_id, created_at desc);
create index bank_statement_entries_page on public.bank_statement_entries(import_id, disposition, line_number);
create index bank_statement_entries_fingerprint on public.bank_statement_entries(organization_id, fingerprint) where disposition = 'accepted';
create index bank_payment_allocations_invoice on public.bank_payment_allocations(organization_id, invoice_id) where is_committed;
create index counterparty_payment_accounts_lookup on public.counterparty_payment_accounts(organization_id, account_number);
create index bank_statement_entries_import_fingerprint on public.bank_statement_entries(import_id, fingerprint);
create index invoices_open_match on public.invoices(organization_id, currency, variable_symbol, due_date, id)
  include (amount, paid_amount, counterparty_name, counterparty_ico) where status in ('pending', 'overdue');
create index invoices_open_normalized_vs on public.invoices(
  organization_id,
  currency,
  (coalesce(nullif(ltrim(coalesce(variable_symbol,''),'0'),''),'0'))
) where status in ('pending', 'overdue') and variable_symbol is not null;
create index invoices_invoice_number_trgm on public.invoices using gin (invoice_number extensions.gin_trgm_ops);
create index invoices_counterparty_name_trgm on public.invoices using gin (counterparty_name extensions.gin_trgm_ops);
create index invoices_counterparty_ico_trgm on public.invoices using gin (counterparty_ico extensions.gin_trgm_ops);
create index invoices_counterparty_email_trgm on public.invoices using gin (counterparty_email extensions.gin_trgm_ops);
create index invoices_variable_symbol_trgm on public.invoices using gin (variable_symbol extensions.gin_trgm_ops);

alter table public.bank_statement_imports enable row level security;
alter table public.bank_statement_entries enable row level security;
alter table public.bank_payment_allocations enable row level security;
alter table public.counterparty_payment_accounts enable row level security;

alter table public.bank_statement_imports add constraint bank_statement_imports_org_id_unique unique(organization_id,id);
alter table public.bank_statement_entries add constraint bank_statement_entries_org_id_unique unique(organization_id,id);
alter table public.bank_payments add constraint bank_payments_org_id_unique unique(organization_id,id);
alter table public.bank_statement_entries add constraint bank_statement_entries_import_same_org
  foreign key(organization_id,import_id) references public.bank_statement_imports(organization_id,id) on delete cascade;
alter table public.bank_payment_allocations add constraint bank_payment_allocations_entry_same_org
  foreign key(organization_id,statement_entry_id) references public.bank_statement_entries(organization_id,id) on delete cascade;
alter table public.bank_payment_allocations add constraint bank_payment_allocations_payment_same_org
  foreign key(organization_id,bank_payment_id) references public.bank_payments(organization_id,id) on delete cascade;
alter table public.bank_payment_allocations add constraint bank_payment_allocations_invoice_same_org
  foreign key(organization_id,invoice_id) references public.invoices(organization_id,id) on delete restrict;

create policy "members can view statement imports" on public.bank_statement_imports for select to authenticated using (private.is_org_member(organization_id));
create policy "members can view statement entries" on public.bank_statement_entries for select to authenticated using (private.is_org_member(organization_id));
create policy "members can view payment allocations" on public.bank_payment_allocations for select to authenticated using (private.is_org_member(organization_id));
create policy "members can view counterparty accounts" on public.counterparty_payment_accounts for select to authenticated using (private.is_org_member(organization_id));

revoke all on public.bank_statement_imports, public.bank_statement_entries, public.bank_payment_allocations, public.counterparty_payment_accounts from anon, authenticated;
grant select on public.bank_statement_imports, public.bank_statement_entries, public.bank_payment_allocations, public.counterparty_payment_accounts to authenticated;
grant all on public.bank_statement_imports, public.bank_statement_entries, public.bank_payment_allocations, public.counterparty_payment_accounts to service_role;

-- Backfill the legacy one-payment-to-one-invoice relationships without changing them.
insert into public.bank_payment_allocations(organization_id, bank_payment_id, invoice_id, amount, is_committed, created_by, committed_at)
select p.organization_id, p.id, p.invoice_id, p.amount, true, p.imported_by, coalesce(p.matched_at, p.created_at)
from public.bank_payments p
where p.invoice_id is not null
on conflict do nothing;

create or replace function public.sync_legacy_bank_payment_allocation()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.invoice_id is not null and new.invoice_id is distinct from old.invoice_id then
    delete from public.bank_payment_allocations
    where bank_payment_id=new.id and invoice_id=old.invoice_id and statement_entry_id is null;
  end if;
  if new.invoice_id is not null and new.invoice_id is distinct from old.invoice_id then
    insert into public.bank_payment_allocations(organization_id,bank_payment_id,invoice_id,amount,is_committed,created_by,committed_at)
    values(new.organization_id,new.id,new.invoice_id,new.amount,true,new.imported_by,coalesce(new.matched_at,now()))
    on conflict do nothing;
  elsif new.invoice_id is null and old.invoice_id is not null then
    delete from public.bank_payment_allocations where bank_payment_id=new.id and invoice_id=old.invoice_id and statement_entry_id is null;
  end if;
  return new;
end $$;
revoke all on function public.sync_legacy_bank_payment_allocation() from public,anon,authenticated;
drop trigger if exists bank_payments_sync_legacy_allocation on public.bank_payments;
create trigger bank_payments_sync_legacy_allocation after update of invoice_id on public.bank_payments
for each row execute function public.sync_legacy_bank_payment_allocation();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('bank-statements', 'bank-statements', false, 5242880, array['application/octet-stream', 'text/plain', 'text/csv'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.create_bank_statement_preview(
  target_org uuid, actor_user uuid, import_data jsonb, entry_rows jsonb
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  result_import public.bank_statement_imports%rowtype;
  normalized_hash text := lower(trim(import_data->>'file_hash'));
begin
  if not exists(select 1 from public.organization_members where organization_id=target_org and user_id=actor_user and role in('accounting','admin')) then
    raise exception 'insufficient_payment_import_permission';
  end if;
  if jsonb_typeof(entry_rows) <> 'array' or jsonb_array_length(entry_rows) < 1 or jsonb_array_length(entry_rows) > 10000 then
    raise exception 'invalid_statement_batch';
  end if;
  if normalized_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_file_hash'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));

  select * into result_import from public.bank_statement_imports
  where organization_id=target_org and file_hash=normalized_hash;
  if found then
    return jsonb_build_object('id', result_import.id, 'revision', result_import.revision, 'duplicate', true, 'status', result_import.status);
  end if;

  insert into public.bank_statement_imports(
    organization_id, source_format, original_filename, file_hash, storage_path, statement_account,
    period_from, period_to, account_mismatch, entry_count, accepted_count, ignored_count, error_count, created_by
  ) values (
    target_org, import_data->>'source_format', left(import_data->>'original_filename',255), normalized_hash,
    nullif(import_data->>'storage_path',''), nullif(import_data->>'statement_account',''),
    nullif(import_data->>'period_from','')::date, nullif(import_data->>'period_to','')::date,
    coalesce((import_data->>'account_mismatch')::boolean,false), jsonb_array_length(entry_rows),
    coalesce((import_data->>'accepted_count')::integer,0), coalesce((import_data->>'ignored_count')::integer,0),
    coalesce((import_data->>'error_count')::integer,0), actor_user
  ) returning * into result_import;

  insert into public.bank_statement_entries(
    organization_id, import_id, line_number, record_type, fingerprint, disposition, reason, external_id,
    booked_on, amount, currency, variable_symbol, counterparty_name, counterparty_account, note,
    proposal_kind, proposal_confidence, proposal_reason, proposed_invoice_ids
  )
  select target_org, result_import.id, row.line_number, row.record_type, row.fingerprint,
    case when row.disposition='accepted' and exists(
      select 1 from public.bank_statement_entries prior
      join public.bank_statement_imports prior_import on prior_import.id=prior.import_id
      where prior.organization_id=target_org and prior.fingerprint=row.fingerprint and prior_import.status='committed'
    ) then 'duplicate' else row.disposition end,
    row.reason, row.external_id, row.booked_on, row.amount, row.currency, nullif(row.variable_symbol,''),
    row.counterparty_name, row.counterparty_account, row.note, row.proposal_kind, row.proposal_confidence,
    row.proposal_reason, coalesce(row.proposed_invoice_ids,'{}'::uuid[])
  from jsonb_to_recordset(entry_rows) as row(
    line_number integer, record_type text, fingerprint text, disposition text, reason text, external_id text,
    booked_on date, amount numeric, currency text, variable_symbol text, counterparty_name text,
    counterparty_account text, note text, proposal_kind text, proposal_confidence text,
    proposal_reason text, proposed_invoice_ids uuid[]
  );
  update public.bank_statement_imports statement set
    accepted_count=(select count(*) from public.bank_statement_entries where import_id=statement.id and disposition='accepted'),
    ignored_count=(select count(*) from public.bank_statement_entries where import_id=statement.id and disposition in('ignored','duplicate')),
    error_count=(select count(*) from public.bank_statement_entries where import_id=statement.id and disposition='error')
  where statement.id=result_import.id;
  insert into public.bank_payment_allocations(organization_id,statement_entry_id,invoice_id,amount,created_by)
  select target_org,entry.id,entry.proposed_invoice_ids[1],entry.amount,actor_user
  from public.bank_statement_entries entry
  join public.invoices invoice on invoice.id=entry.proposed_invoice_ids[1] and invoice.organization_id=target_org
  where entry.import_id=result_import.id and entry.disposition='accepted' and entry.proposal_confidence='safe'
    and cardinality(entry.proposed_invoice_ids)=1 and entry.amount=invoice.amount-invoice.paid_amount and entry.currency=invoice.currency;
  return jsonb_build_object('id', result_import.id, 'revision', result_import.revision, 'duplicate', false, 'status', result_import.status);
end $$;

create or replace function public.save_bank_statement_allocations(
  target_org uuid, actor_user uuid, target_import uuid, expected_revision integer, reviewed_entries jsonb, allocation_rows jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare new_revision integer;
begin
  if not exists(select 1 from public.organization_members where organization_id=target_org and user_id=actor_user and role in('accounting','admin')) then
    raise exception 'insufficient_payment_import_permission';
  end if;
  if jsonb_typeof(reviewed_entries)<>'array' or jsonb_typeof(allocation_rows)<>'array'
    or jsonb_array_length(reviewed_entries)>10000 or jsonb_array_length(allocation_rows)>10000 then raise exception 'invalid_allocations'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  update public.bank_statement_imports set revision=revision+1, updated_at=now()
  where id=target_import and organization_id=target_org and status='review' and revision=expected_revision
  returning revision into new_revision;
  if new_revision is null then raise exception 'revision_conflict'; end if;
  if (select count(distinct value::text::uuid) from jsonb_array_elements_text(reviewed_entries))
      <> jsonb_array_length(reviewed_entries)
    or (select count(*) from public.bank_statement_entries entry
        where entry.import_id=target_import and entry.organization_id=target_org and entry.disposition='accepted'
          and entry.id in(select value::text::uuid from jsonb_array_elements_text(reviewed_entries)))
      <> jsonb_array_length(reviewed_entries) then
    raise exception 'invalid_reviewed_entries';
  end if;
  delete from public.bank_payment_allocations where organization_id=target_org and is_committed=false
    and statement_entry_id in(select value::text::uuid from jsonb_array_elements_text(reviewed_entries));
  insert into public.bank_payment_allocations(organization_id, statement_entry_id, invoice_id, amount, is_manual_partial, created_by)
  select target_org, row.entry_id, row.invoice_id, row.amount, coalesce(row.is_manual_partial,false), actor_user
  from jsonb_to_recordset(allocation_rows) row(entry_id uuid, invoice_id uuid, amount numeric, is_manual_partial boolean)
  join public.bank_statement_entries entry on entry.id=row.entry_id and entry.import_id=target_import and entry.organization_id=target_org and entry.disposition='accepted'
  join public.invoices invoice on invoice.id=row.invoice_id and invoice.organization_id=target_org and invoice.status in('pending','overdue')
  where row.amount > 0;
  if (select count(*) from public.bank_payment_allocations where statement_entry_id in(select value::text::uuid from jsonb_array_elements_text(reviewed_entries)) and not is_committed)
     <> jsonb_array_length(allocation_rows) then raise exception 'invalid_allocation_target'; end if;
  return jsonb_build_object('id', target_import, 'revision', new_revision);
end $$;

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
    counterparty_name, counterparty_account, note, match_status, imported_by, matched_at)
  select target_org,
    case when count(allocation.id)=1 and sum(allocation.amount)=entry.amount then (array_agg(allocation.invoice_id order by allocation.invoice_id))[1] else null end,
    entry.external_id, entry.booked_on, entry.amount, entry.currency, entry.variable_symbol, entry.counterparty_name,
    entry.counterparty_account, entry.note,
    case when count(allocation.id)>0 and sum(allocation.amount)=entry.amount then 'matched'
         when count(allocation.id)>0 then 'ambiguous' else 'unmatched' end,
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

create or replace function public.unassign_bank_payment_allocations(target_org uuid, target_payment uuid, actor_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare allocation_record record; payment_record public.bank_payments%rowtype; released integer:=0; last_invoice uuid; last_remaining numeric;
  policy_days integer[]; policy_active boolean; next_time_value timestamptz; company_today date:=(now() at time zone 'Europe/Prague')::date;
begin
  if not exists(select 1 from public.organization_members where organization_id=target_org and user_id=actor_user and role in('accounting','admin')) then
    raise exception 'insufficient_payment_unassignment_permission';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  select * into payment_record from public.bank_payments where id=target_payment and organization_id=target_org for update;
  if not found then raise exception 'payment_not_found'; end if;
  for allocation_record in
    select allocation.*, invoice.amount invoice_amount, invoice.paid_amount invoice_paid, invoice.due_date
    from public.bank_payment_allocations allocation join public.invoices invoice on invoice.id=allocation.invoice_id
    where allocation.bank_payment_id=target_payment and allocation.organization_id=target_org and allocation.is_committed
    order by allocation.invoice_id for update of invoice
  loop
    policy_days:=array[-3,0,7,14]; policy_active:=true;
    select days_from_due,is_active into policy_days,policy_active from public.reminder_policies
    where organization_id=target_org and (id=(select reminder_policy_id from public.invoices where id=allocation_record.invoice_id) or is_default)
    order by (id=(select reminder_policy_id from public.invoices where id=allocation_record.invoice_id)) desc limit 1;
    next_time_value:=case when not coalesce(policy_active,true) then null else (
      select case when count(*) filter(where allocation_record.due_date+d<=company_today)>0 then (company_today+time '06:00') at time zone 'Europe/Prague'
        else ((min(allocation_record.due_date+d))+time '06:00') at time zone 'Europe/Prague' end from unnest(coalesce(policy_days,array[-3,0,7,14])) d) end;
    update public.invoices set paid_amount=greatest(0,paid_amount-allocation_record.amount), paid_at=null,
      status=case when due_date<(now() at time zone 'Europe/Prague')::date then 'overdue' else 'pending' end,
      next_reminder_at=case when reminders_paused then null else next_time_value end,
      updated_by=actor_user, updated_at=now() where id=allocation_record.invoice_id and organization_id=target_org
      returning id, amount-paid_amount into last_invoice,last_remaining;
    released:=released+1;
  end loop;
  delete from public.bank_payment_allocations where bank_payment_id=target_payment and organization_id=target_org and is_committed;
  update public.bank_payments set invoice_id=null, match_status='unmatched', matched_at=null where id=target_payment and organization_id=target_org;
  return jsonb_build_object('payment_id',target_payment,'status','unmatched','released_allocations',released,
    'invoice_id',case when released=1 then last_invoice else null end,'remaining',case when released=1 then last_remaining else null end);
end $$;

revoke all on function public.create_bank_statement_preview(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.save_bank_statement_allocations(uuid,uuid,uuid,integer,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.commit_bank_statement_import(uuid,uuid,uuid,integer,boolean) from public,anon,authenticated;
revoke all on function public.unassign_bank_payment_allocations(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_bank_statement_preview(uuid,uuid,jsonb,jsonb) to service_role;
grant execute on function public.save_bank_statement_allocations(uuid,uuid,uuid,integer,jsonb,jsonb) to service_role;
grant execute on function public.commit_bank_statement_import(uuid,uuid,uuid,integer,boolean) to service_role;
grant execute on function public.unassign_bank_payment_allocations(uuid,uuid,uuid) to service_role;

create or replace function public.save_default_reminder_settings_versioned(
  target_org uuid, new_days integer[], template_data jsonb, new_active boolean, actor_user uuid, expected_event uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare latest_event uuid; change_result jsonb;
begin
  if not exists(select 1 from public.organization_members where organization_id=target_org and user_id=actor_user and role in('accounting','admin')) then raise exception 'insufficient_permission'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  select id into latest_event from public.reminder_settings_events where organization_id=target_org order by created_at desc,id desc limit 1;
  if latest_event is distinct from expected_event then raise exception 'revision_conflict'; end if;
  change_result:=public.save_default_reminder_settings(target_org,new_days,template_data,new_active,actor_user);
  update public.reminder_policies set is_active=new_active,updated_at=now() where organization_id=target_org;
  perform public.refresh_reminder_next_times(target_org,new_active);
  return change_result;
end $$;
revoke all on function public.save_default_reminder_settings_versioned(uuid,integer[],jsonb,boolean,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_default_reminder_settings_versioned(uuid,integer[],jsonb,boolean,uuid,uuid) to service_role;

create or replace function public.list_invoices_page_filtered(
  target_org uuid, actor_user uuid, search_query text default null, status_filter text default null,
  currency_filter text default null, issue_from date default null, issue_to date default null,
  due_from date default null, due_to date default null, amount_min numeric default null, amount_max numeric default null,
  payment_state text default null, bank_match_state text default null, page_number integer default 1, page_size integer default 25
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not exists(select 1 from public.organization_members where organization_id=target_org and user_id=actor_user) then raise exception 'insufficient_permission'; end if;
  if page_number<1 or page_size<1 or page_size>500 then raise exception 'invalid_pagination'; end if;
  if status_filter is not null and status_filter not in('pending','overdue','paid','cancelled','closed') then raise exception 'invalid_status'; end if;
  if payment_state is not null and payment_state not in('unpaid','partial','paid') then raise exception 'invalid_payment_state'; end if;
  if bank_match_state is not null and bank_match_state not in('matched','unmatched') then raise exception 'invalid_bank_match_state'; end if;
  if issue_from>issue_to or due_from>due_to or amount_min<0 or amount_max<0 or amount_min>amount_max then raise exception 'invalid_range'; end if;
  with filtered as materialized(
    select invoice.* from public.invoices invoice
    where invoice.organization_id=target_org
      and(status_filter is null or invoice.status=status_filter or(status_filter='closed' and invoice.status in('paid','cancelled')))
      and(currency_filter is null or invoice.currency=currency_filter)
      and(issue_from is null or invoice.issue_date>=issue_from) and(issue_to is null or invoice.issue_date<=issue_to)
      and(due_from is null or invoice.due_date>=due_from) and(due_to is null or invoice.due_date<=due_to)
      and(amount_min is null or invoice.amount>=amount_min) and(amount_max is null or invoice.amount<=amount_max)
      and(payment_state is null or payment_state='unpaid' and invoice.paid_amount=0
        or payment_state='partial' and invoice.paid_amount>0 and invoice.paid_amount<invoice.amount
        or payment_state='paid' and invoice.paid_amount=invoice.amount)
      and(bank_match_state is null or bank_match_state='matched' and exists(select 1 from public.bank_payment_allocations allocation where allocation.organization_id=target_org and allocation.invoice_id=invoice.id and allocation.is_committed)
        or bank_match_state='unmatched' and not exists(select 1 from public.bank_payment_allocations allocation where allocation.organization_id=target_org and allocation.invoice_id=invoice.id and allocation.is_committed))
      and(nullif(trim(search_query),'') is null or invoice.invoice_number ilike '%'||trim(search_query)||'%'
        or invoice.counterparty_name ilike '%'||trim(search_query)||'%' or coalesce(invoice.counterparty_ico,'') ilike '%'||trim(search_query)||'%'
        or invoice.counterparty_email ilike '%'||trim(search_query)||'%' or coalesce(invoice.variable_symbol,'') ilike '%'||trim(search_query)||'%')
  ), paged as(
    select * from filtered order by case status when 'overdue' then 0 when 'pending' then 1 when 'paid' then 2 else 3 end,
      case when status in('overdue','pending') then due_date end asc nulls last,
      case when status='paid' then paid_at end desc nulls last,updated_at desc,id asc
    offset(page_number-1)*page_size limit page_size
  ), totals as(select currency,sum(amount-paid_amount) amount from filtered where status in('pending','overdue') group by currency),
  currencies as(select distinct currency from public.invoices where organization_id=target_org)
  select jsonb_build_object('invoices',coalesce((select jsonb_agg(to_jsonb(row)) from paged row),'[]'::jsonb),
    'total',(select count(*) from filtered),'open_totals',coalesce((select jsonb_object_agg(currency,amount) from totals),'{}'::jsonb),
    'currencies',coalesce((select jsonb_agg(currency order by currency) from currencies),'[]'::jsonb),
    'active_count',(select count(*) from public.invoices where organization_id=target_org and status in('pending','overdue'))) into result;
  return result;
end $$;
revoke all on function public.list_invoices_page_filtered(uuid,uuid,text,text,text,date,date,date,date,numeric,numeric,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.list_invoices_page_filtered(uuid,uuid,text,text,text,date,date,date,date,numeric,numeric,text,text,integer,integer) to service_role;

create or replace function public.list_open_invoice_candidates(
  target_org uuid, actor_user uuid, search_query text default null, page_number integer default 1, page_size integer default 25
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not exists(select 1 from public.organization_members where organization_id=target_org and user_id=actor_user and role in('accounting','admin')) then raise exception 'insufficient_permission'; end if;
  if page_number<1 or page_size<1 or page_size>50 or length(coalesce(search_query,''))>100 then raise exception 'invalid_request'; end if;
  with filtered as materialized(
    select id,invoice_number,counterparty_name,counterparty_ico,variable_symbol,amount,paid_amount,currency,due_date
    from public.invoices invoice where organization_id=target_org and status in('pending','overdue')
      and(nullif(trim(search_query),'') is null or invoice_number ilike '%'||trim(search_query)||'%'
        or counterparty_name ilike '%'||trim(search_query)||'%' or coalesce(counterparty_ico,'') ilike '%'||trim(search_query)||'%'
        or coalesce(variable_symbol,'') ilike '%'||trim(search_query)||'%')
  ), paged as(select * from filtered order by due_date,id offset(page_number-1)*page_size limit page_size)
  select jsonb_build_object('invoices',coalesce((select jsonb_agg(to_jsonb(row) order by due_date,id) from paged row),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',page_number,'page_size',page_size) into result;
  return result;
end $$;
revoke all on function public.list_open_invoice_candidates(uuid,uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.list_open_invoice_candidates(uuid,uuid,text,integer,integer) to service_role;
