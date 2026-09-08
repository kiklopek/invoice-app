-- Produkcni schema pro Hlavica Drevo - evidence vydanych faktur a upominek.
-- Soubor je urcen pro novy Supabase projekt. Pozdejsi zmeny budou pres migrace.

create extension if not exists pgcrypto;

-- RLS helper functions live outside the exposed API schema. Authenticated
-- users can execute them from policies, but PostgREST cannot expose them as RPCs.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ico text,
  dic text,
  registered_address text,
  operating_address text,
  data_box_id text,
  phone text,
  email text,
  bank_account_czk text,
  bank_account_eur text,
  ocr_hourly_limit integer default 20 check (ocr_hourly_limit is null or ocr_hourly_limit between 1 and 10000),
  created_at timestamptz not null default now()
);

create table organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null check (email = lower(email)) check (email ~ '^[^@[:space:]]+@hlavica\.cz$'),
  role text not null default 'accounting' check (role in ('viewer', 'accounting', 'admin')),
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

-- Neměnný audit správy přístupů; target_member_id zůstává dohledatelný i po odebrání člena.
create table organization_member_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text not null check (actor_email = lower(actor_email)),
  target_member_id uuid not null,
  target_email text not null check (target_email = lower(target_email)),
  event_type text not null check (event_type in ('added', 'role_changed', 'removed')),
  previous_role text check (previous_role is null or previous_role in ('viewer', 'accounting', 'admin')),
  new_role text check (new_role is null or new_role in ('viewer', 'accounting', 'admin')),
  created_at timestamptz not null default now(),
  check (
    (event_type = 'added' and previous_role is null and new_role is not null)
    or (event_type = 'role_changed' and previous_role is not null and new_role is not null)
    or (event_type = 'removed' and previous_role is not null and new_role is null)
  )
);

create index organization_member_events_org_created
  on organization_member_events (organization_id, created_at desc, id desc);

create or replace function public.valid_reminder_days(days integer[])
returns boolean language sql immutable parallel safe set search_path = pg_catalog as $$
  select days is not null and cardinality(days) between 1 and 10
    and not exists (select 1 from unnest(days) as item(day_value) where day_value < -90 or day_value > 365)
    and (select count(distinct day_value) from unnest(days) as item(day_value)) = cardinality(days)
$$;

revoke all on function public.valid_reminder_days(integer[]) from public, anon;
grant execute on function public.valid_reminder_days(integer[]) to authenticated, service_role;

create table reminder_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  days_from_due integer[] not null default array[-3, 0, 7, 14],
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminder_policies_name_length check (length(trim(name)) between 1 and 100),
  constraint reminder_policies_days_valid check (public.valid_reminder_days(days_from_due))
);

create unique index reminder_policies_one_default
  on reminder_policies (organization_id) where is_default;

create index reminder_policies_active_org_idx
  on reminder_policies (organization_id, is_default, name) where archived_at is null;

create unique index reminder_policies_active_name_unique
  on reminder_policies (organization_id, lower(trim(name))) where archived_at is null;

create or replace function public.set_default_reminder_policy(target_org uuid, target_policy uuid)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from reminder_policies where organization_id = target_org and id = target_policy and archived_at is null) then
    raise exception 'policy_not_found';
  end if;
  update reminder_policies set is_default = false, updated_at = now() where organization_id = target_org and is_default;
  update reminder_policies set is_default = true, updated_at = now() where organization_id = target_org and id = target_policy and archived_at is null;
end;
$$;

revoke all on function public.set_default_reminder_policy(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_default_reminder_policy(uuid, uuid) to service_role;

create or replace function public.refresh_reminder_next_times(target_org uuid, automation_active boolean)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare company_today date := (now() at time zone 'Europe/Prague')::date;
begin
  update invoices invoice set next_reminder_at = case
    when not automation_active or invoice.reminders_paused then null
    else (select case
      when count(*) filter (where invoice.due_date + offset_day <= company_today) > 0 then (company_today + time '06:00') at time zone 'Europe/Prague'
      else ((min(invoice.due_date + offset_day)) + time '06:00') at time zone 'Europe/Prague' end
      from unnest(invoice.reminder_days_snapshot) offset_day
      where invoice.reminder_plan_effective_from is null or invoice.due_date + offset_day >= invoice.reminder_plan_effective_from)
    end
  where invoice.organization_id = target_org and invoice.status in ('pending', 'overdue');
end;
$$;

revoke all on function public.refresh_reminder_next_times(uuid, boolean) from public, anon, authenticated;
grant execute on function public.refresh_reminder_next_times(uuid, boolean) to service_role;

create table email_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  stage text not null check (stage in ('before_due', 'on_due', 'overdue', 'escalation')),
  subject text not null,
  body text not null,
  reply_to text,
  cc text[],
  updated_at timestamptz not null default now(),
  unique (organization_id, stage)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  reminder_policy_id uuid references reminder_policies(id) on delete set null,
  reminder_days_snapshot integer[] not null default array[-3, 0, 7, 14],
  reminder_plan_effective_from date,
  invoice_number text not null,
  counterparty_name text not null,
  counterparty_ico text,
  counterparty_dic text,
  counterparty_email text not null,
  variable_symbol text,
  amount_without_vat numeric(14,2) not null check (amount_without_vat > 0),
  vat_rate numeric(5,2) not null default 0 check (vat_rate >= 0 and vat_rate <= 100),
  amount numeric(14,2) not null check (amount > 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0 and paid_amount <= amount),
  currency char(3) not null default 'CZK',
  issue_date date not null,
  due_date date not null check (due_date >= issue_date),
  status text not null default 'pending' check (status in ('pending', 'paid', 'overdue', 'cancelled')),
  source text not null default 'manual' check (source in ('manual', 'ocr', 'email', 'accounting_api')),
  file_url text,
  notes text,
  paid_at timestamptz,
  reminders_sent integer not null default 0 check (reminders_sent >= 0),
  last_reminder_at timestamptz,
  next_reminder_at timestamptz,
  reminders_paused boolean not null default false,
  reminders_paused_at timestamptz,
  reminders_paused_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, invoice_number),
  constraint invoices_vat_amounts_consistent check (abs(amount - round(amount_without_vat * (100 + vat_rate) / 100, 2)) <= 0.01),
  constraint invoices_reminder_days_snapshot_valid check (public.valid_reminder_days(reminder_days_snapshot))
);

create unique index invoices_one_document on invoices (file_url) where file_url is not null;

create table invoice_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'created', 'updated', 'paid', 'reopened', 'cancelled', 'overdue',
    'reminders_paused', 'reminders_resumed', 'payment_changed'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index invoice_events_invoice on invoice_events (invoice_id, created_at desc);

-- Audit vzniká přímo v databázi, takže jej žádná zapisovací API cesta nemůže vynechat.
create or replace function audit_invoice_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  fields text[];
  status_event text;
begin
  if tg_op = 'INSERT' then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type)
    values (new.organization_id, new.id, new.created_by, 'created');
    return new;
  end if;

  if new.status is distinct from old.status then
    status_event := case
      when new.status = 'paid' then 'paid'
      when old.status = 'paid' and new.status in ('pending', 'overdue') then 'reopened'
      when new.status = 'cancelled' then 'cancelled'
      when new.status = 'overdue' then 'overdue'
      else 'updated'
    end;
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type, details)
    values (
      new.organization_id, new.id,
      case when status_event = 'overdue' then null else new.updated_by end,
      status_event,
      jsonb_build_object('from', old.status, 'to', new.status, 'paid_at', new.paid_at,
        'paid_amount', new.paid_amount, 'remaining', new.amount - new.paid_amount)
    );
  elsif new.paid_at is distinct from old.paid_at and new.status = 'paid' then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type, details)
    values (new.organization_id, new.id, new.updated_by, 'paid', jsonb_build_object('paid_at', new.paid_at, 'corrected', true));
  end if;

  if new.reminders_paused is distinct from old.reminders_paused then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type)
    values (
      new.organization_id, new.id, coalesce(new.reminders_paused_by, new.updated_by),
      case when new.reminders_paused then 'reminders_paused' else 'reminders_resumed' end
    );
  end if;

  if new.paid_amount is distinct from old.paid_amount
    and new.status <> 'paid' and old.status <> 'paid' then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type, details)
    values (new.organization_id, new.id, new.updated_by, 'payment_changed', jsonb_build_object(
      'from', old.paid_amount, 'to', new.paid_amount, 'remaining', new.amount - new.paid_amount
    ));
  end if;

  fields := array_remove(array[
    case when new.invoice_number is distinct from old.invoice_number then 'invoice_number' end,
    case when new.counterparty_name is distinct from old.counterparty_name then 'counterparty_name' end,
    case when new.counterparty_ico is distinct from old.counterparty_ico then 'counterparty_ico' end,
    case when new.counterparty_dic is distinct from old.counterparty_dic then 'counterparty_dic' end,
    case when new.counterparty_email is distinct from old.counterparty_email then 'counterparty_email' end,
    case when new.variable_symbol is distinct from old.variable_symbol then 'variable_symbol' end,
    case when new.amount is distinct from old.amount then 'amount' end,
    case when new.currency is distinct from old.currency then 'currency' end,
    case when new.issue_date is distinct from old.issue_date then 'issue_date' end,
    case when new.due_date is distinct from old.due_date then 'due_date' end,
    case when new.notes is distinct from old.notes then 'notes' end
  ]::text[], null);
  if cardinality(fields) > 0 then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type, details)
    values (new.organization_id, new.id, new.updated_by, 'updated', jsonb_build_object('fields', fields));
  end if;
  return new;
end;
$$;

create trigger invoices_audit_change
after insert or update on invoices
for each row execute function audit_invoice_change();

revoke all on function audit_invoice_change() from public, anon, authenticated;

create table invoice_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  path text not null unique,
  original_name text not null,
  expected_mime text not null check (expected_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  expected_size integer not null check (expected_size between 16 and 10485760),
  status text not null default 'pending' check (status in ('pending', 'verified', 'claimed')),
  created_by uuid references auth.users(id) on delete set null,
  invoice_id uuid references invoices(id) on delete set null,
  expires_at timestamptz not null,
  verified_at timestamptz,
  ocr_status text not null default 'idle' check (ocr_status in ('idle', 'processing', 'succeeded', 'failed')),
  ocr_attempt_count integer not null default 0 check (ocr_attempt_count between 0 and 3),
  ocr_started_at timestamptz,
  ocr_completed_at timestamptz,
  ocr_error text,
  ocr_model text,
  ocr_provider_response_id text,
  ocr_field_sources jsonb not null default '{}'::jsonb check (jsonb_typeof(ocr_field_sources) = 'object'),
  created_at timestamptz not null default now()
);

create index invoice_uploads_cleanup on invoice_uploads (status, expires_at);

-- Atomický zámek brání dvojímu OCR a omezuje nákladné zpracování na tři pokusy.
create or replace function claim_invoice_ocr(target_upload_id uuid, target_user_id uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare claimed_id uuid;
begin
  update invoice_uploads set
    ocr_status = 'processing',
    ocr_attempt_count = ocr_attempt_count + 1,
    ocr_started_at = now(),
    ocr_completed_at = null,
    ocr_error = null
  where id = target_upload_id
    and created_by = target_user_id
    and status = 'verified'
    and expires_at > now()
    and ocr_attempt_count < 3
    and (ocr_status in ('idle', 'failed') or (ocr_status = 'processing' and ocr_started_at < now() - interval '5 minutes'))
  returning id into claimed_id;
  return claimed_id is not null;
end;
$$;
revoke all on function claim_invoice_ocr(uuid, uuid) from public, anon, authenticated;
grant execute on function claim_invoice_ocr(uuid, uuid) to service_role;

-- Správa rolí je atomická; advisory lock zabrání souběžnému odebrání posledních administrátorů.
create or replace function add_organization_member(
  target_org uuid, new_email text, new_role text, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  actor_email_value text; member_id uuid; member_created timestamptz;
  event_id uuid; event_created timestamptz; normalized_email text := lower(trim(new_email));
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  if new_role not in ('viewer', 'accounting', 'admin') then raise exception 'invalid_role'; end if;
  if length(normalized_email) < 3 or length(normalized_email) > 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid_email'; end if;
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin';
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;
  insert into organization_members (organization_id, email, role) values (target_org, normalized_email, new_role)
  returning id, created_at into member_id, member_created;
  insert into organization_member_events (organization_id, actor_user_id, actor_email, target_member_id, target_email, event_type, new_role)
  values (target_org, actor_user, actor_email_value, member_id, normalized_email, 'added', new_role)
  returning id, created_at into event_id, event_created;
  return jsonb_build_object(
    'member', jsonb_build_object('id', member_id, 'email', normalized_email, 'role', new_role, 'user_id', null, 'created_at', member_created),
    'event', jsonb_build_object('id', event_id, 'actor_email', actor_email_value, 'target_email', normalized_email,
      'event_type', 'added', 'previous_role', null, 'new_role', new_role, 'created_at', event_created));
end;
$$;

create or replace function update_organization_member_role(
  target_org uuid, target_member uuid, new_role text, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare previous_role_value text; member_email text; member_user uuid; member_created timestamptz;
  actor_email_value text; event_id uuid; event_created timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  if new_role not in ('viewer', 'accounting', 'admin') then raise exception 'invalid_role'; end if;
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin';
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;
  select role, email, user_id, created_at into previous_role_value, member_email, member_user, member_created
  from organization_members where id = target_member and organization_id = target_org for update;
  if not found then raise exception 'member_not_found'; end if;
  if previous_role_value = 'admin' and new_role <> 'admin'
    and (select count(*) from organization_members where organization_id = target_org and role = 'admin') <= 1 then raise exception 'last_admin'; end if;
  update organization_members set role = new_role where id = target_member;
  insert into organization_member_events (organization_id, actor_user_id, actor_email, target_member_id, target_email, event_type, previous_role, new_role)
  values (target_org, actor_user, actor_email_value, target_member, member_email, 'role_changed', previous_role_value, new_role)
  returning id, created_at into event_id, event_created;
  return jsonb_build_object(
    'member', jsonb_build_object('id', target_member, 'email', member_email, 'role', new_role, 'user_id', member_user, 'created_at', member_created),
    'event', jsonb_build_object('id', event_id, 'actor_email', actor_email_value, 'target_email', member_email,
      'event_type', 'role_changed', 'previous_role', previous_role_value, 'new_role', new_role, 'created_at', event_created));
end;
$$;

create or replace function delete_organization_member(
  target_org uuid, target_member uuid, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare previous_role_value text; member_user uuid; member_email text;
  auth_user uuid; member_created timestamptz;
  actor_email_value text; event_id uuid; event_created timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin';
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;
  select role, user_id, email, created_at into previous_role_value, member_user, member_email, member_created
  from organization_members where id = target_member and organization_id = target_org for update;
  if not found then raise exception 'member_not_found'; end if;
  if member_user = actor_user then raise exception 'cannot_remove_self'; end if;
  if previous_role_value = 'admin'
    and (select count(*) from organization_members where organization_id = target_org and role = 'admin') <= 1 then raise exception 'last_admin'; end if;
  auth_user := member_user;
  if auth_user is null then
    select id into auth_user from auth.users where lower(email) = member_email limit 1;
  end if;
  insert into organization_member_events (organization_id, actor_user_id, actor_email, target_member_id, target_email, event_type, previous_role)
  values (target_org, actor_user, actor_email_value, target_member, member_email, 'removed', previous_role_value)
  returning id, created_at into event_id, event_created;
  delete from organization_members where id = target_member and organization_id = target_org;
  return jsonb_build_object('removed', true, 'id', target_member, 'email', member_email,
    'previous_role', previous_role_value, 'member_user_id', member_user,
    'auth_user_id', auth_user, 'created_at', member_created,
    'event', jsonb_build_object('id', event_id, 'actor_email', actor_email_value, 'target_email', member_email,
      'event_type', 'removed', 'previous_role', previous_role_value, 'new_role', null, 'created_at', event_created));
end;
$$;

create or replace function restore_organization_member_after_auth_delete_failure(
  target_org uuid, target_member uuid, target_user uuid, target_email text,
  target_role text, target_created timestamptz, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare actor_email_value text; restored_member organization_members%rowtype;
  event_id uuid; event_created timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin';
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;
  if target_role not in ('viewer', 'accounting', 'admin') then raise exception 'invalid_role'; end if;
  insert into organization_members (id, organization_id, user_id, email, role, created_at)
  values (target_member, target_org, target_user, lower(trim(target_email)), target_role, target_created)
  returning * into restored_member;
  insert into organization_member_events (organization_id, actor_user_id, actor_email, target_member_id, target_email, event_type, new_role)
  values (target_org, actor_user, actor_email_value, target_member, restored_member.email, 'added', restored_member.role)
  returning id, created_at into event_id, event_created;
  return jsonb_build_object('member', to_jsonb(restored_member),
    'event', jsonb_build_object('id', event_id, 'actor_email', actor_email_value,
      'target_email', restored_member.email, 'event_type', 'added', 'previous_role', null,
      'new_role', restored_member.role, 'created_at', event_created));
end;
$$;

revoke all on function add_organization_member(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function update_organization_member_role(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function delete_organization_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function restore_organization_member_after_auth_delete_failure(uuid, uuid, uuid, text, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function add_organization_member(uuid, text, text, uuid) to service_role;
grant execute on function update_organization_member_role(uuid, uuid, text, uuid) to service_role;
grant execute on function delete_organization_member(uuid, uuid, uuid) to service_role;
grant execute on function restore_organization_member_after_auth_delete_failure(uuid, uuid, uuid, text, text, timestamptz, uuid) to service_role;

create table reminder_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  stage text not null check (stage in ('before_due', 'on_due', 'overdue', 'escalation')),
  scheduled_for date not null,
  sent_at timestamptz,
  sent_to text not null,
  provider_message_id text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  delivery_status text check (delivery_status is null or delivery_status in ('accepted', 'delivered', 'delayed', 'bounced', 'complained', 'failed')),
  delivery_event_at timestamptz,
  delivered_at timestamptz,
  delivery_error text,
  error_message text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id, stage, scheduled_for)
);

-- Provozni stopa kazdeho behu automatu. Jeden run_key muze mit samostatny
-- radek pro kazdou organizaci, aby se mezi firmami nesdilely provozni pocty.
create table reminder_automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  run_key uuid not null,
  trigger_source text not null default 'scheduled' check (trigger_source in ('scheduled', 'manual')),
  triggered_by uuid references auth.users(id) on delete set null,
  triggered_by_email text check (triggered_by_email is null or triggered_by_email = lower(triggered_by_email)),
  status text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  checked integer not null default 0 check (checked >= 0),
  sent integer not null default 0 check (sent >= 0),
  failed integer not null default 0 check (failed >= 0),
  skipped integer not null default 0 check (skipped >= 0),
  disabled integer not null default 0 check (disabled >= 0),
  paused integer not null default 0 check (paused >= 0),
  suppressed integer not null default 0 check (suppressed >= 0),
  exhausted integer not null default 0 check (exhausted >= 0),
  error_message text check (error_message is null or length(error_message) <= 1000),
  unique (organization_id, run_key),
  check ((trigger_source = 'scheduled' and triggered_by_email is null) or (trigger_source = 'manual' and triggered_by_email is not null)),
  check ((status = 'running' and finished_at is null) or (status <> 'running' and finished_at is not null))
);

create index reminder_automation_runs_org_started
  on reminder_automation_runs (organization_id, started_at desc);

create unique index reminder_automation_runs_one_running_per_org
  on reminder_automation_runs (organization_id)
  where status = 'running';

-- Nemenný audit každé změny plánu a textů automatických upomínek.
create table reminder_settings_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text not null check (actor_email = lower(actor_email)),
  is_active boolean not null,
  days_from_due integer[] not null,
  template_data jsonb not null check (jsonb_typeof(template_data) = 'object'),
  created_at timestamptz not null default now()
);

create index reminder_settings_events_org_created
  on reminder_settings_events (organization_id, created_at desc, id desc);

-- Bez osobních dat uchovává ID již zpracovaných webhooků; Resend je doručuje alespoň jednou.
create table provider_webhook_events (
  event_id text primary key,
  event_type text not null check (event_type in (
    'email.sent', 'email.delivered', 'email.delivery_delayed',
    'email.bounced', 'email.complained', 'email.failed'
  )),
  provider_message_id text not null,
  event_at timestamptz not null,
  received_at timestamptz not null default now()
);

-- Trvalé odmítnutí nebo stížnost zastaví další odesílání na vadnou adresu.
-- Po opravě adresy faktury se automat může bezpečně znovu rozběhnout.
create table email_suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null check (email = lower(email)),
  reason text not null check (reason in ('bounced', 'complained')),
  provider_message_id text,
  last_event_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

-- Přijaté bankovní platby. Externí ID z banky zajišťuje idempotentní import.
create table bank_payments (
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
  imported_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  matched_at timestamptz,
  unmatched_at timestamptz,
  unmatched_by uuid references auth.users(id) on delete set null,
  unique (organization_id, external_id),
  constraint bank_payments_match_consistency check (
    (match_status = 'matched' and invoice_id is not null and matched_at is not null)
    or (match_status <> 'matched' and invoice_id is null)
  )
);

create index invoices_org_status_due on invoices (organization_id, status, due_date);
create index invoices_report_issue on invoices (organization_id, currency, issue_date);
create index invoices_report_due on invoices (organization_id, currency, due_date);
create index invoices_report_paid on invoices (organization_id, currency, ((paid_at at time zone 'Europe/Prague')::date));
create index invoices_report_customer on invoices (organization_id, counterparty_name);
create index reminder_log_invoice on reminder_log (invoice_id, created_at desc);
create index reminder_log_queue on reminder_log (status, scheduled_for) where status = 'queued';
create index reminder_log_provider_message on reminder_log (provider_message_id) where provider_message_id is not null;
create index email_suppressions_org on email_suppressions (organization_id, email);
create index bank_payments_review on bank_payments (organization_id, match_status, booked_on desc);
create index bank_payments_invoice on bank_payments (invoice_id, booked_on desc);
-- Defense in depth: vazby na fakturu nebo politiku musi zustat uvnitr stejne organizace.
alter table reminder_policies
  add constraint reminder_policies_org_id_key unique (organization_id, id);
alter table invoices
  add constraint invoices_org_id_key unique (organization_id, id);
alter table invoices
  add constraint invoices_policy_same_org_fkey foreign key (organization_id, reminder_policy_id)
  references reminder_policies (organization_id, id);
alter table invoice_events
  add constraint invoice_events_invoice_same_org_fkey foreign key (organization_id, invoice_id)
  references invoices (organization_id, id);
alter table invoice_uploads
  add constraint invoice_uploads_invoice_same_org_fkey foreign key (organization_id, invoice_id)
  references invoices (organization_id, id);
alter table reminder_log
  add constraint reminder_log_invoice_same_org_fkey foreign key (organization_id, invoice_id)
  references invoices (organization_id, id);
alter table bank_payments
  add constraint bank_payments_invoice_same_org_fkey foreign key (organization_id, invoice_id)
  references invoices (organization_id, id);

-- Stav faktury a odeslani ma jednoznacny databazovy vyznam i pri chybe serveroveho kodu.
alter table invoices
  add constraint invoices_paid_state_check check ((status = 'paid') = (paid_at is not null));
alter table invoices
  add constraint invoices_payment_balance_state_check check (
    (status = 'paid' and paid_amount = amount)
    or (status in ('pending', 'overdue') and paid_amount < amount)
    or (status = 'cancelled' and paid_amount = 0)
  );
alter table invoices
  add constraint invoices_closed_schedule_check check (status in ('pending', 'overdue') or next_reminder_at is null);
alter table reminder_log
  add constraint reminder_log_sent_state_check check ((status = 'sent') = (sent_at is not null));
alter table reminder_log
  add constraint reminder_log_provider_state_check check (provider_message_id is null or status = 'sent');

-- Atomicky zapise uspesne odeslani, aby soubezne procesy neztratily citac.
create or replace function record_reminder_sent(
  target_invoice_id uuid,
  sent_time timestamptz,
  next_time timestamptz
) returns void language sql security definer set search_path = public
as $$
  update invoices set
    reminders_sent = reminders_sent + 1,
    last_reminder_at = sent_time,
    next_reminder_at = next_time,
    updated_at = sent_time
  where id = target_invoice_id;
$$;

-- Funkce používá service role v cron routě. Klient ji nesmí volat přímo.
revoke all on function record_reminder_sent(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function record_reminder_sent(uuid, timestamptz, timestamptz) to service_role;

-- Dokončení odeslání a zvýšení počítadla proběhne v jedné databázové transakci.
create or replace function complete_reminder_send(
  target_log_id uuid,
  provider_id text,
  sent_time timestamptz,
  next_time timestamptz
) returns boolean language plpgsql security definer set search_path = public
as $$
declare
  target_invoice_id uuid;
begin
  update reminder_log set
    status = 'sent',
    sent_at = sent_time,
    provider_message_id = provider_id,
    delivery_status = 'accepted',
    delivery_event_at = sent_time,
    delivered_at = null,
    delivery_error = null,
    error_message = null,
    updated_at = sent_time
  where id = target_log_id and status = 'queued'
  returning invoice_id into target_invoice_id;

  if target_invoice_id is null then
    return false;
  end if;

  update invoices set
    reminders_sent = reminders_sent + 1,
    last_reminder_at = sent_time,
    next_reminder_at = next_time,
    updated_at = sent_time
  where id = target_invoice_id;

  return found;
end;
$$;

revoke all on function complete_reminder_send(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function complete_reminder_send(uuid, text, timestamptz, timestamptz) to service_role;

-- Idempotentní a pořadí odolné zpracování doručovacího webhooku.
create or replace function process_resend_delivery_event(
  webhook_event_id text,
  webhook_event_type text,
  message_id text,
  event_time timestamptz,
  event_error text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  target_log reminder_log%rowtype;
  normalized_status text;
  was_duplicate boolean;
begin
  if webhook_event_type not in (
    'email.sent', 'email.delivered', 'email.delivery_delayed',
    'email.bounced', 'email.complained', 'email.failed'
  ) or length(webhook_event_id) not between 1 and 200 or length(message_id) not between 1 and 200 then
    raise exception 'invalid resend webhook event';
  end if;

  insert into provider_webhook_events (event_id, event_type, provider_message_id, event_at)
  values (webhook_event_id, webhook_event_type, message_id, event_time)
  on conflict (event_id) do nothing;
  was_duplicate := not found;

  normalized_status := case webhook_event_type
    when 'email.sent' then 'accepted'
    when 'email.delivered' then 'delivered'
    when 'email.delivery_delayed' then 'delayed'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.failed' then 'failed'
  end;

  select * into target_log from reminder_log
  where provider_message_id = message_id
  order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('duplicate', was_duplicate, 'matched', false); end if;

  if target_log.delivery_event_at is null or event_time >= target_log.delivery_event_at then
    update reminder_log set
      delivery_status = normalized_status,
      delivery_event_at = event_time,
      delivered_at = case when webhook_event_type = 'email.delivered' then event_time else delivered_at end,
      delivery_error = case
        when webhook_event_type in ('email.bounced', 'email.complained', 'email.failed', 'email.delivery_delayed')
          then nullif(left(coalesce(event_error, ''), 1000), '')
        else null
      end,
      updated_at = now()
    where id = target_log.id;
  end if;

  if webhook_event_type in ('email.bounced', 'email.complained') then
    insert into email_suppressions (organization_id, email, reason, provider_message_id, last_event_at)
    values (
      target_log.organization_id, lower(target_log.sent_to),
      case when webhook_event_type = 'email.bounced' then 'bounced' else 'complained' end,
      message_id, event_time
    )
    on conflict (organization_id, email) do update set
      reason = case when excluded.last_event_at >= email_suppressions.last_event_at then excluded.reason else email_suppressions.reason end,
      provider_message_id = case when excluded.last_event_at >= email_suppressions.last_event_at then excluded.provider_message_id else email_suppressions.provider_message_id end,
      last_event_at = greatest(email_suppressions.last_event_at, excluded.last_event_at);
  end if;

  return jsonb_build_object('duplicate', was_duplicate, 'matched', true, 'log_id', target_log.id);
end;
$$;

revoke all on function process_resend_delivery_event(text, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function process_resend_delivery_event(text, text, text, timestamptz, text) to service_role;

-- Uloží výchozí plán i šablony a ve stejné transakci přepočítá otevřené faktury.
create or replace function save_default_reminder_settings(
  target_org uuid,
  new_days integer[],
  template_data jsonb,
  new_active boolean,
  actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  target_policy_id uuid;
  company_today date := (now() at time zone 'Europe/Prague')::date;
  actor_email_value text;
  event_id uuid;
  event_created_at timestamptz;
  stage_name text;
  stage_template jsonb;
  reply_to_value text;
  cc_values text[];
  normalized_templates jsonb := '{}'::jsonb;
begin
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role in ('accounting', 'admin');
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;

  if new_days is null or cardinality(new_days) < 1 or cardinality(new_days) > 10
    or exists (select 1 from unnest(new_days) as offsets(day_value) where day_value < -90 or day_value > 365)
    or (select count(distinct day_value) from unnest(new_days) as offsets(day_value)) <> cardinality(new_days) then
    raise exception 'invalid_days';
  end if;
  if template_data is null or jsonb_typeof(template_data) <> 'object' then
    raise exception 'invalid_templates';
  end if;
  foreach stage_name in array array['before_due', 'on_due', 'overdue', 'escalation'] loop
    stage_template := template_data -> stage_name;
    if stage_template is null or jsonb_typeof(stage_template) <> 'object'
      or coalesce(length(trim(stage_template ->> 'subject')), 0) not between 1 and 300
      or coalesce(length(trim(stage_template ->> 'body')), 0) not between 1 and 20000 then
      raise exception 'invalid_templates';
    end if;

    reply_to_value := nullif(lower(trim(coalesce(stage_template ->> 'reply_to', ''))), '');
    if reply_to_value is not null and (
      length(reply_to_value) > 254
      or reply_to_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ) then raise exception 'invalid_reply_to';
    end if;

    if stage_template ? 'cc' and stage_template -> 'cc' <> 'null'::jsonb
      and jsonb_typeof(stage_template -> 'cc') <> 'array' then
      raise exception 'invalid_cc';
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(nullif(stage_template -> 'cc', 'null'::jsonb), '[]'::jsonb)) as cc_item(value)
      where jsonb_typeof(cc_item.value) <> 'string'
    ) then raise exception 'invalid_cc';
    end if;
    select coalesce(array_agg(distinct lower(trim(value))) filter (where trim(value) <> ''), '{}'::text[])
      into cc_values
      from jsonb_array_elements_text(coalesce(nullif(stage_template -> 'cc', 'null'::jsonb), '[]'::jsonb)) item(value);
    if cardinality(cc_values) > 5 or exists (
      select 1 from unnest(cc_values) as copies(email_value)
      where length(email_value) > 254 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ) then raise exception 'invalid_cc';
    end if;

    normalized_templates := normalized_templates || jsonb_build_object(stage_name, jsonb_build_object(
      'subject', trim(stage_template ->> 'subject'),
      'body', trim(stage_template ->> 'body'),
      'reply_to', reply_to_value,
      'cc', to_jsonb(cc_values)
    ));
  end loop;

  select id into target_policy_id
  from reminder_policies
  where organization_id = target_org and is_default
  for update;

  if target_policy_id is null then
    insert into reminder_policies (organization_id, name, is_default, days_from_due, is_active)
    values (target_org, 'Výchozí upomínky', true, new_days, new_active)
    returning id into target_policy_id;
  else
    update reminder_policies
    set days_from_due = new_days, is_active = new_active, updated_at = now()
    where id = target_policy_id;
  end if;

  insert into email_templates (organization_id, stage, subject, body, reply_to, cc, updated_at)
  select target_org, item.key, item.value ->> 'subject', item.value ->> 'body',
    nullif(item.value ->> 'reply_to', ''),
    array(select jsonb_array_elements_text(item.value -> 'cc')),
    now()
  from jsonb_each(normalized_templates) item
  on conflict (organization_id, stage) do update set
    subject = excluded.subject,
    body = excluded.body,
    reply_to = excluded.reply_to,
    cc = excluded.cc,
    updated_at = excluded.updated_at;

  update invoices invoice set
    reminder_policy_id = target_policy_id,
    next_reminder_at = case when not new_active or invoice.reminders_paused then null else (
      select case
        when count(*) filter (where invoice.due_date + offset_day <= company_today) > 0
          then (company_today + time '06:00') at time zone 'Europe/Prague'
        else ((min(invoice.due_date + offset_day)) + time '06:00') at time zone 'Europe/Prague'
      end
      from unnest(new_days) offset_day
    ) end,
    updated_at = now()
  where invoice.organization_id = target_org
    and invoice.status in ('pending', 'overdue')
    and (invoice.reminder_policy_id is null or invoice.reminder_policy_id = target_policy_id);

  insert into reminder_settings_events (
    organization_id, actor_user_id, actor_email, is_active, days_from_due, template_data
  ) values (
    target_org, actor_user, actor_email_value, new_active, new_days, normalized_templates
  ) returning id, created_at into event_id, event_created_at;

  return jsonb_build_object('id', event_id, 'changed_at', event_created_at, 'changed_by', actor_email_value);
end;
$$;

revoke all on function save_default_reminder_settings(uuid, integer[], jsonb, boolean, uuid) from public, anon, authenticated;
grant execute on function save_default_reminder_settings(uuid, integer[], jsonb, boolean, uuid) to service_role;

-- Import a bezpečné párování proběhnou v jedné transakci. Automaticky se uzavře
-- pouze jediná otevřená faktura se shodným VS, měnou a přesnou částkou.
create or replace function import_and_reconcile_bank_payments(
  target_org uuid,
  actor_user uuid,
  payment_rows jsonb
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  payment jsonb;
  payment_id uuid;
  candidate_id uuid;
  candidate_number text;
  candidate_count integer;
  candidate_remaining numeric;
  imported_count integer := 0;
  matched_count integer := 0;
  partial_matched_count integer := 0;
  unmatched_count integer := 0;
  ambiguous_count integer := 0;
  duplicate_count integer := 0;
  results jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(payment_rows) <> 'array'
    or jsonb_array_length(payment_rows) < 1
    or jsonb_array_length(payment_rows) > 500 then
    raise exception 'invalid payment batch';
  end if;
  if not exists (
    select 1 from organization_members
    where organization_id = target_org and user_id = actor_user and role in ('accounting', 'admin')
  ) then
    raise exception 'insufficient payment import permission';
  end if;

  for payment in select value from jsonb_array_elements(payment_rows)
  loop
    payment_id := null;
    candidate_id := null;
    candidate_number := null;
    candidate_count := 0;
    candidate_remaining := null;

    insert into bank_payments (
      organization_id, external_id, booked_on, amount, currency, variable_symbol,
      counterparty_name, counterparty_account, note, imported_by
    ) values (
      target_org,
      trim(payment ->> 'external_id'),
      (payment ->> 'booked_on')::date,
      (payment ->> 'amount')::numeric,
      upper(payment ->> 'currency'),
      nullif(trim(payment ->> 'variable_symbol'), ''),
      nullif(trim(payment ->> 'counterparty_name'), ''),
      nullif(trim(payment ->> 'counterparty_account'), ''),
      nullif(trim(payment ->> 'note'), ''),
      actor_user
    )
    on conflict (organization_id, external_id) do nothing
    returning id into payment_id;

    if payment_id is null then
      duplicate_count := duplicate_count + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'external_id', payment ->> 'external_id', 'status', 'duplicate'
      ));
      continue;
    end if;
    imported_count := imported_count + 1;

    if nullif(trim(payment ->> 'variable_symbol'), '') is not null then
      select count(*), (array_agg(id order by id))[1], (array_agg(invoice_number order by id))[1]
      into candidate_count, candidate_id, candidate_number
      from invoices
      where organization_id = target_org
        and status in ('pending', 'overdue')
        and variable_symbol = trim(payment ->> 'variable_symbol')
        and currency = upper(payment ->> 'currency')
        and (payment ->> 'amount')::numeric <= amount - paid_amount;
    end if;

    if candidate_count = 1 then
      select amount - paid_amount into candidate_remaining from invoices
      where id = candidate_id and organization_id = target_org and status in ('pending', 'overdue')
      for update;
      if candidate_remaining is null or (payment ->> 'amount')::numeric > candidate_remaining then
        candidate_count := 0;
      end if;
    end if;

    if candidate_count = 1 then
      update bank_payments set invoice_id = candidate_id, match_status = 'matched', matched_at = now()
      where id = payment_id;
      update invoices set
        paid_amount = paid_amount + (payment ->> 'amount')::numeric,
        status = case when paid_amount + (payment ->> 'amount')::numeric = amount then 'paid'
          when due_date < (now() at time zone 'Europe/Prague')::date then 'overdue' else 'pending' end,
        paid_at = case when paid_amount + (payment ->> 'amount')::numeric = amount
          then ((payment ->> 'booked_on')::date + time '12:00') at time zone 'Europe/Prague' else null end,
        next_reminder_at = case when paid_amount + (payment ->> 'amount')::numeric = amount then null else next_reminder_at end,
        updated_by = actor_user, updated_at = now()
      where id = candidate_id and organization_id = target_org and status in ('pending', 'overdue');
      matched_count := matched_count + 1;
      if (payment ->> 'amount')::numeric < candidate_remaining then partial_matched_count := partial_matched_count + 1; end if;
      results := results || jsonb_build_array(jsonb_build_object(
        'external_id', payment ->> 'external_id', 'status', 'matched',
        'invoice_id', candidate_id, 'invoice_number', candidate_number,
        'settlement', case when (payment ->> 'amount')::numeric = candidate_remaining then 'full' else 'partial' end,
        'remaining', candidate_remaining - (payment ->> 'amount')::numeric
      ));
    elsif candidate_count > 1 then
      update bank_payments set match_status = 'ambiguous' where id = payment_id;
      ambiguous_count := ambiguous_count + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'external_id', payment ->> 'external_id', 'status', 'ambiguous'
      ));
    else
      unmatched_count := unmatched_count + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'external_id', payment ->> 'external_id', 'status', 'unmatched'
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'imported', imported_count, 'matched', matched_count, 'unmatched', unmatched_count,
    'partial_matched', partial_matched_count,
    'ambiguous', ambiguous_count, 'duplicates', duplicate_count, 'results', results
  );
end;
$$;

revoke all on function import_and_reconcile_bank_payments(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function import_and_reconcile_bank_payments(uuid, uuid, jsonb) to service_role;

-- Ruční řešení výjimky. Platba nesmí překročit zbývající částku faktury;
-- více menších plateb tak může pohledávku postupně uhradit.
create or replace function assign_bank_payment(
  target_org uuid,
  target_payment uuid,
  target_invoice uuid,
  actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  selected_payment bank_payments%rowtype;
  selected_invoice invoices%rowtype;
  new_paid_amount numeric;
  remaining_amount numeric;
begin
  if not exists (
    select 1 from organization_members
    where organization_id = target_org and user_id = actor_user and role in ('accounting', 'admin')
  ) then
    raise exception 'insufficient payment assignment permission';
  end if;

  select * into selected_payment from bank_payments
  where id = target_payment and organization_id = target_org and match_status in ('unmatched', 'ambiguous')
  for update;
  if not found then raise exception 'payment is not available for assignment'; end if;

  select * into selected_invoice from invoices
  where id = target_invoice and organization_id = target_org and status in ('pending', 'overdue')
  for update;
  if not found then raise exception 'invoice is not available for assignment'; end if;

  remaining_amount := selected_invoice.amount - selected_invoice.paid_amount;
  if selected_payment.amount > remaining_amount or selected_payment.currency <> selected_invoice.currency then
    raise exception 'payment exceeds remaining amount or currency does not match invoice';
  end if;
  new_paid_amount := selected_invoice.paid_amount + selected_payment.amount;

  update bank_payments set invoice_id = selected_invoice.id, match_status = 'matched', matched_at = now(), unmatched_at = null, unmatched_by = null
  where id = selected_payment.id;
  update invoices set
    paid_amount = new_paid_amount,
    status = case when new_paid_amount = amount then 'paid'
      when due_date < (now() at time zone 'Europe/Prague')::date then 'overdue' else 'pending' end,
    paid_at = case when new_paid_amount = amount then (selected_payment.booked_on + time '12:00') at time zone 'Europe/Prague' else null end,
    next_reminder_at = case when new_paid_amount = amount then null else next_reminder_at end,
    updated_by = actor_user, updated_at = now()
  where id = selected_invoice.id;

  return jsonb_build_object(
    'payment_id', selected_payment.id, 'invoice_id', selected_invoice.id,
    'invoice_number', selected_invoice.invoice_number, 'status', 'matched',
    'settlement', case when new_paid_amount = selected_invoice.amount then 'full' else 'partial' end,
    'paid_amount', new_paid_amount, 'remaining', selected_invoice.amount - new_paid_amount,
    'invoice_status', case when new_paid_amount = selected_invoice.amount then 'paid'
      when selected_invoice.due_date < (now() at time zone 'Europe/Prague')::date then 'overdue' else 'pending' end
  );
end;
$$;

revoke all on function assign_bank_payment(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function assign_bank_payment(uuid, uuid, uuid, uuid) to service_role;

-- Uvolnění chybně přiřazené bankovní platby znovu spočítá zůstatek faktury
-- a v téže transakci obnoví její otevřený stav i plánování upomínek.
create or replace function unassign_bank_payment(
  target_org uuid,
  target_payment uuid,
  actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  selected_payment bank_payments%rowtype;
  selected_invoice invoices%rowtype;
  new_paid_amount numeric;
  new_status text;
  policy_days integer[] := array[-3, 0, 7, 14];
  policy_active boolean := true;
  company_today date := (now() at time zone 'Europe/Prague')::date;
  next_time_value timestamptz;
begin
  if not exists (
    select 1 from organization_members
    where organization_id = target_org and user_id = actor_user and role in ('accounting', 'admin')
  ) then raise exception 'insufficient payment unassignment permission'; end if;

  select * into selected_payment from bank_payments
  where id = target_payment and organization_id = target_org and match_status = 'matched' and invoice_id is not null
  for update;
  if not found then raise exception 'matched payment not found'; end if;

  select * into selected_invoice from invoices
  where id = selected_payment.invoice_id and organization_id = target_org for update;
  if not found then raise exception 'invoice not found'; end if;

  new_paid_amount := greatest(0, selected_invoice.paid_amount - selected_payment.amount);
  new_status := case when selected_invoice.due_date < company_today then 'overdue' else 'pending' end;
  select days_from_due, is_active into policy_days, policy_active from reminder_policies
  where organization_id = target_org
    and (id = selected_invoice.reminder_policy_id or (selected_invoice.reminder_policy_id is null and is_default))
  order by (id = selected_invoice.reminder_policy_id) desc limit 1;
  next_time_value := case when selected_invoice.reminders_paused or not coalesce(policy_active, true) then null else (
    select case when count(*) filter (where selected_invoice.due_date + offset_day <= company_today) > 0
      then (company_today + time '06:00') at time zone 'Europe/Prague'
      else ((min(selected_invoice.due_date + offset_day)) + time '06:00') at time zone 'Europe/Prague' end
    from unnest(coalesce(policy_days, array[-3, 0, 7, 14])) offset_day
  ) end;

  update bank_payments set invoice_id = null, match_status = 'unmatched', matched_at = null,
    unmatched_at = now(), unmatched_by = actor_user
  where id = selected_payment.id;
  update invoices set status = new_status, paid_amount = new_paid_amount, paid_at = null,
    next_reminder_at = next_time_value, updated_by = actor_user, updated_at = now()
  where id = selected_invoice.id;

  if selected_invoice.status = 'paid' then
    update reminder_log set status = 'failed',
      error_message = 'Bankovní platba byla uvolněna; krok čeká na nové vyhodnocení.', updated_at = now()
    where invoice_id = selected_invoice.id and status = 'skipped' and sent_at is null;
  end if;

  return jsonb_build_object(
    'payment_id', selected_payment.id, 'invoice_id', selected_invoice.id,
    'invoice_number', selected_invoice.invoice_number, 'status', 'unmatched',
    'invoice_status', new_status, 'paid_amount', new_paid_amount,
    'remaining', selected_invoice.amount - new_paid_amount
  );
end;
$$;

revoke all on function unassign_bank_payment(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function unassign_bank_payment(uuid, uuid, uuid) to service_role;

-- Oprava chybne sparovane uhrady musi byt jedna transakce: platba se uvolni,
-- faktura se znovu otevre a neodeslane kroky se vrati k novemu vyhodnoceni.
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

revoke all on function reopen_paid_invoice(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function reopen_paid_invoice(uuid, uuid, uuid, text, timestamptz) to service_role;

-- Strankovany seznam s filtry a presnymi souhrny se pocita v databazi. Do
-- prohlizece se neposila cela historie faktur.
create or replace function list_invoices_page(
  target_org uuid,
  actor_user uuid,
  search_query text default null,
  status_filter text default null,
  currency_filter text default null,
  issue_from date default null,
  issue_to date default null,
  page_number integer default 1,
  page_size integer default 25
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not exists (
    select 1 from organization_members
    where organization_id = target_org and user_id = actor_user
  ) then raise exception 'insufficient_permission'; end if;
  if page_number < 1 or page_size < 1 or page_size > 500 then raise exception 'invalid_pagination'; end if;
  if status_filter is not null and status_filter not in ('pending', 'overdue', 'paid', 'cancelled', 'closed') then raise exception 'invalid_status'; end if;
  if currency_filter is not null and currency_filter !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;
  if issue_from is not null and issue_to is not null and issue_from > issue_to then raise exception 'invalid_period'; end if;

  with filtered as materialized (
    select i.* from invoices i
    where i.organization_id = target_org
      and (status_filter is null or i.status = status_filter or (status_filter = 'closed' and i.status in ('paid', 'cancelled')))
      and (currency_filter is null or i.currency = currency_filter)
      and (issue_from is null or i.issue_date >= issue_from)
      and (issue_to is null or i.issue_date <= issue_to)
      and (
        nullif(trim(search_query), '') is null
        or i.invoice_number ilike '%' || trim(search_query) || '%'
        or i.counterparty_name ilike '%' || trim(search_query) || '%'
        or i.counterparty_email ilike '%' || trim(search_query) || '%'
        or coalesce(i.variable_symbol, '') ilike '%' || trim(search_query) || '%'
      )
  ), paged as (
    select * from filtered
    order by
      case status when 'overdue' then 0 when 'pending' then 1 when 'paid' then 2 else 3 end,
      case when status in ('overdue', 'pending') then due_date end asc nulls last,
      case when status = 'paid' then paid_at end desc nulls last,
      updated_at desc,
      id asc
    offset (page_number - 1) * page_size limit page_size
  ), totals as (
    select currency, sum(amount - paid_amount) as amount from filtered
    where status in ('pending', 'overdue') group by currency
  ), available_currencies as (
    select distinct currency from invoices where organization_id = target_org
  )
  select jsonb_build_object(
    'invoices', coalesce((select jsonb_agg(to_jsonb(p) order by
      case p.status when 'overdue' then 0 when 'pending' then 1 when 'paid' then 2 else 3 end,
      case when p.status in ('overdue', 'pending') then p.due_date end asc nulls last,
      case when p.status = 'paid' then p.paid_at end desc nulls last,
      p.updated_at desc,
      p.id asc
    ) from paged p), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'open_totals', coalesce((select jsonb_object_agg(currency, amount) from totals), '{}'::jsonb),
    'currencies', coalesce((select jsonb_agg(currency order by currency) from available_currencies), '[]'::jsonb),
    'active_count', (select count(*) from invoices where organization_id = target_org and status in ('pending', 'overdue'))
  ) into result;
  return result;
end;
$$;

revoke all on function list_invoices_page(uuid, uuid, text, text, text, date, date, integer, integer) from public, anon, authenticated;
grant execute on function list_invoices_page(uuid, uuid, text, text, text, date, date, integer, integer) to service_role;

create or replace function invoice_report_summary(
  target_org uuid, actor_user uuid, report_from date, report_to date,
  date_basis text, currency_filter text, status_filter text default null,
  customer_filter text default null, as_of_date date default current_date
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user) then raise exception 'insufficient_permission'; end if;
  if report_from > report_to then raise exception 'invalid_period'; end if;
  if date_basis not in ('issue_date', 'due_date', 'paid_at') then raise exception 'invalid_date_basis'; end if;
  if currency_filter !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;
  if status_filter is not null and status_filter not in ('pending', 'overdue', 'paid', 'cancelled') then raise exception 'invalid_status'; end if;

  with filtered as materialized (
    select i.* from invoices i where i.organization_id = target_org
      and i.currency = currency_filter
      and (status_filter is null or i.status = status_filter)
      and (customer_filter is null or i.counterparty_name = customer_filter)
      and ((date_basis = 'issue_date' and i.issue_date between report_from and report_to)
        or (date_basis = 'due_date' and i.due_date between report_from and report_to)
        or (date_basis = 'paid_at' and (i.paid_at at time zone 'Europe/Prague')::date between report_from and report_to))
  ), aging_values as (
    select case when as_of_date - due_date <= 0 then 0 when as_of_date - due_date <= 7 then 1 when as_of_date - due_date <= 14 then 2 when as_of_date - due_date <= 30 then 3 else 4 end as bucket,
      sum(amount - paid_amount) as amount, count(*) as count
    from filtered where status in ('pending', 'overdue') group by 1
  ), monthly_values as (
    select to_char(issue_date, 'YYYY-MM') as month_key, sum(amount) as issued,
      coalesce(sum(paid_amount), 0) as paid
    from filtered group by 1
  ), debtor_values as (
    select counterparty_name as name, sum(amount - paid_amount) as open,
      coalesce(sum(amount - paid_amount) filter (where status = 'overdue'), 0) as overdue,
      count(*) as count, sum(reminders_sent) as reminders
    from filtered where status in ('pending', 'overdue') group by counterparty_name
  )
  select jsonb_build_object(
    'invoice_count', (select count(*) from filtered),
    'total', coalesce((select sum(amount) from filtered), 0),
    'paid', coalesce((select sum(paid_amount) from filtered where status <> 'cancelled'), 0),
    'overdue', coalesce((select sum(amount - paid_amount) from filtered where status = 'overdue'), 0),
    'open', coalesce((select sum(amount - paid_amount) from filtered where status in ('pending', 'overdue')), 0),
    'paid_rate', coalesce((select round(100 * coalesce(sum(paid_amount) filter (where status <> 'cancelled'), 0) / nullif(coalesce(sum(amount) filter (where status <> 'cancelled'), 0), 0)) from filtered), 0)::integer,
    'counts', jsonb_build_object(
      'pending', (select count(*) from filtered where status = 'pending'),
      'overdue', (select count(*) from filtered where status = 'overdue'),
      'paid', (select count(*) from filtered where status = 'paid'),
      'cancelled', (select count(*) from filtered where status = 'cancelled')
    ),
    'aging', coalesce((select jsonb_agg(jsonb_build_object(
      'label', case g.bucket when 0 then 'Před splatností' when 1 then '1–7 dní' when 2 then '8–14 dní' when 3 then '15–30 dní' else 'Více než 30 dní' end,
      'amount', coalesce(a.amount, 0), 'count', coalesce(a.count, 0)
    ) order by g.bucket) from generate_series(0, 4) g(bucket) left join aging_values a using (bucket)), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('key', month_key, 'issued', issued, 'paid', paid) order by month_key) from monthly_values), '[]'::jsonb),
    'debtors', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'open', open, 'overdue', overdue, 'count', count, 'reminders', reminders) order by open desc, name) from debtor_values), '[]'::jsonb),
    'currencies', coalesce((select jsonb_agg(currency order by currency) from (select distinct currency from invoices where organization_id = target_org) c), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(counterparty_name order by counterparty_name) from (select distinct counterparty_name from invoices where organization_id = target_org) n), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function invoice_report_rows_page(
  target_org uuid, actor_user uuid, report_from date, report_to date,
  date_basis text, currency_filter text, status_filter text default null,
  customer_filter text default null, page_number integer default 1, page_size integer default 500
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user) then raise exception 'insufficient_permission'; end if;
  if report_from > report_to or page_number < 1 or page_size < 1 or page_size > 500 then raise exception 'invalid_request'; end if;
  if date_basis not in ('issue_date', 'due_date', 'paid_at') or currency_filter !~ '^[A-Z]{3}$' then raise exception 'invalid_filter'; end if;
  if status_filter is not null and status_filter not in ('pending', 'overdue', 'paid', 'cancelled') then raise exception 'invalid_status'; end if;

  with filtered as materialized (
    select i.invoice_number, i.counterparty_name, i.amount_without_vat, i.vat_rate, i.amount, i.paid_amount, i.amount - i.paid_amount as remaining_amount,
      i.currency, i.issue_date, i.due_date, i.paid_at, i.status, i.reminders_sent, i.id
    from invoices i where i.organization_id = target_org and i.currency = currency_filter
      and (status_filter is null or i.status = status_filter)
      and (customer_filter is null or i.counterparty_name = customer_filter)
      and ((date_basis = 'issue_date' and i.issue_date between report_from and report_to)
        or (date_basis = 'due_date' and i.due_date between report_from and report_to)
        or (date_basis = 'paid_at' and (i.paid_at at time zone 'Europe/Prague')::date between report_from and report_to))
  ), paged as (
    select * from filtered order by issue_date, id offset (page_number - 1) * page_size limit page_size
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(p) order by p.issue_date, p.id) from paged p), '[]'::jsonb),
    'total', (select count(*) from filtered)
  ) into result;
  return result;
end;
$$;

revoke all on function invoice_report_summary(uuid, uuid, date, date, text, text, text, text, date) from public, anon, authenticated;
grant execute on function invoice_report_summary(uuid, uuid, date, date, text, text, text, text, date) to service_role;
revoke all on function invoice_report_rows_page(uuid, uuid, date, date, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function invoice_report_rows_page(uuid, uuid, date, date, text, text, text, text, integer, integer) to service_role;

-- Bounded dashboard payload: aggregates plus only the visible recent and upcoming rows.
create index if not exists invoices_org_created on invoices (organization_id, created_at desc, id desc);
create index if not exists invoices_org_next_reminder on invoices (organization_id, next_reminder_at, id)
  where status in ('pending', 'overdue') and next_reminder_at is not null;

create or replace function dashboard_summary(target_org uuid, actor_user uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user) then raise exception 'insufficient_permission'; end if;
  with currency_totals as (
    select currency, coalesce(sum(amount - paid_amount) filter (where status in ('pending', 'overdue')), 0) as open_amount,
      coalesce(sum(amount - paid_amount) filter (where status = 'overdue'), 0) as overdue_amount,
      coalesce(sum(paid_amount) filter (where status <> 'cancelled'), 0) as paid_amount
    from invoices where organization_id = target_org group by currency
  ), recent as (
    select id, invoice_number, variable_symbol, counterparty_name, counterparty_email, amount, paid_amount, currency, due_date, status, reminders_sent, created_at
    from invoices where organization_id = target_org order by created_at desc, id desc limit 5
  ), upcoming as (
    select id, invoice_number, counterparty_name, amount, paid_amount, currency, status, next_reminder_at
    from invoices where organization_id = target_org and status in ('pending', 'overdue') and next_reminder_at is not null
    order by next_reminder_at, id limit 4
  )
  select jsonb_build_object(
    'open_totals', coalesce((select jsonb_object_agg(currency, open_amount) from currency_totals where open_amount > 0), '{}'::jsonb),
    'overdue_totals', coalesce((select jsonb_object_agg(currency, overdue_amount) from currency_totals where overdue_amount > 0), '{}'::jsonb),
    'paid_totals', coalesce((select jsonb_object_agg(currency, paid_amount) from currency_totals where paid_amount > 0), '{}'::jsonb),
    'active_count', (select count(*) from invoices where organization_id = target_org and status in ('pending', 'overdue')),
    'overdue_count', (select count(*) from invoices where organization_id = target_org and status = 'overdue'),
    'reminders_sent', coalesce((select sum(reminders_sent) from invoices where organization_id = target_org), 0),
    'recent', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc) from recent r), '[]'::jsonb),
    'upcoming', coalesce((select jsonb_agg(to_jsonb(u) order by u.next_reminder_at, u.id) from upcoming u), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function dashboard_summary(uuid, uuid) from public, anon, authenticated;
grant execute on function dashboard_summary(uuid, uuid) to service_role;

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

  update bank_payments
  set invoice_id = null,
      match_status = 'unmatched',
      matched_at = null,
      unmatched_at = now(),
      unmatched_by = actor_user
  where organization_id = target_org
    and invoice_id = target_invoice;
  get diagnostics detached_payments = row_count;

  delete from invoices
  where id = target_invoice and organization_id = target_org;

  return jsonb_build_object(
    'invoice_id', target_invoice,
    'file_url', selected_invoice.file_url,
    'detached_payments', detached_payments
  );
end;
$$;

revoke all on function delete_invoice_safely(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function delete_invoice_safely(uuid, uuid, uuid) to service_role;

-- Soukromy bucket; dokumenty se ctou a zapisuji pouze pres autorizovane serverove routy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoice-documents', 'invoice-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = excluded.allowed_mime_types;

alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table organization_member_events enable row level security;
alter table reminder_policies enable row level security;
alter table email_templates enable row level security;
alter table invoices enable row level security;
alter table invoice_events enable row level security;
alter table invoice_uploads enable row level security;
alter table reminder_log enable row level security;
alter table reminder_automation_runs enable row level security;
alter table reminder_settings_events enable row level security;
alter table provider_webhook_events enable row level security;
alter table email_suppressions enable row level security;
alter table bank_payments enable row level security;

-- Klientské role smějí data pouze číst. Všechny zápisy procházejí serverovým
-- API, které ověřuje roli a používá service role; nelze tak obejít validaci a
-- měnit technická pole jako reminders_sent nebo organization_id.
revoke insert, update, delete on organizations from anon, authenticated;
revoke insert, update, delete on organization_members from anon, authenticated;
revoke insert, update, delete on organization_member_events from anon, authenticated;
revoke insert, update, delete on reminder_policies from anon, authenticated;
revoke insert, update, delete on email_templates from anon, authenticated;
revoke insert, update, delete on invoices from anon, authenticated;
revoke insert, update, delete on invoice_events from anon, authenticated;
revoke insert, update, delete on invoice_uploads from anon, authenticated;
revoke insert, update, delete on reminder_log from anon, authenticated;
revoke insert, update, delete on reminder_automation_runs from anon, authenticated;
revoke insert, update, delete on reminder_settings_events from anon, authenticated;
revoke all on provider_webhook_events from anon, authenticated;
revoke insert, update, delete on email_suppressions from anon, authenticated;
revoke insert, update, delete on bank_payments from anon, authenticated;

create or replace function private.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = target_org
      and (m.user_id = (select auth.uid()) or lower(m.email) = lower((select auth.jwt()) ->> 'email'))
  );
$$;

create or replace function private.has_org_role(target_org uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = target_org
      and m.role = any(allowed_roles)
      and (m.user_id = (select auth.uid()) or (m.user_id is null and lower(m.email) = lower((select auth.jwt()) ->> 'email')))
  );
$$;

revoke all on function private.is_org_member(uuid) from public, anon, authenticated;
revoke all on function private.has_org_role(uuid, text[]) from public, anon, authenticated;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, text[]) to authenticated, service_role;

create policy "members can view organization" on organizations for select to authenticated
  using (private.is_org_member(id));
create policy "members can view memberships" on organization_members for select to authenticated
  using (private.is_org_member(organization_id));
create policy "members can view organization member events" on organization_member_events for select to authenticated
  using (private.is_org_member(organization_id));
create policy "members can view policies" on reminder_policies for select to authenticated
  using (private.is_org_member(organization_id));
create policy "members can view templates" on email_templates for select to authenticated
  using (private.is_org_member(organization_id));
create policy "members can view invoices" on invoices for select to authenticated
  using (private.is_org_member(organization_id));
create policy "members can view invoice events" on invoice_events for select to authenticated
  using (private.is_org_member(organization_id));
create policy "members can view invoice uploads" on invoice_uploads for select to authenticated
  using (private.is_org_member(organization_id));
create policy "accounting can create invoices" on invoices for insert to authenticated
  with check (private.has_org_role(organization_id, array['accounting', 'admin']) and created_by = (select auth.uid()));
create policy "accounting can update invoices" on invoices for update to authenticated
  using (private.has_org_role(organization_id, array['accounting', 'admin']))
  with check (private.has_org_role(organization_id, array['accounting', 'admin']));
create policy "members can view reminder log" on reminder_log for select to authenticated
  using (private.is_org_member(organization_id));
create policy "members can view reminder automation runs" on reminder_automation_runs for select to authenticated
  using (private.is_org_member(organization_id));
create policy "members can view reminder settings events" on reminder_settings_events for select to authenticated
  using (private.is_org_member(organization_id));
create policy "members can view email suppressions" on email_suppressions for select to authenticated
  using (private.is_org_member(organization_id));
create policy "members can view bank payments" on bank_payments for select to authenticated
  using (private.is_org_member(organization_id));

-- Prvotni zalozeni firmy proved service-role skript nebo Supabase SQL editor:
-- insert into organizations (name, ico) values ('Hlavica Drevo', 'DOPLNIT_ICO') returning id;
-- insert into organization_members (organization_id, email, role)
-- values ('ORGANIZATION_UUID', 'ucetni@firma.cz', 'admin');
-- insert into reminder_policies (organization_id, name, is_default)
-- values ('ORGANIZATION_UUID', 'Vychozi upominky', true);

-- Jednorázové e-mailové kódy druhého kroku přihlášení. Tabulka je dostupná
-- pouze service role; klientské role nemají žádnou politiku ani oprávnění.
create table email_mfa_challenges (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index email_mfa_challenges_user_session_created
  on email_mfa_challenges (user_id, session_id, created_at desc);

alter table email_mfa_challenges enable row level security;
revoke all on email_mfa_challenges from public, anon, authenticated;
grant select, insert, update, delete on email_mfa_challenges to service_role;

create or replace function create_email_mfa_challenge(
  target_challenge uuid, target_user uuid, target_session uuid,
  target_code_hash text, target_expires_at timestamptz
) returns text language plpgsql security definer set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(target_user::text || ':' || target_session::text, 0));
  if exists (
    select 1 from email_mfa_challenges
    where user_id = target_user and created_at > now() - interval '60 seconds'
  ) then return 'rate_limited'; end if;
  update email_mfa_challenges set consumed_at = coalesce(consumed_at, now())
  where user_id = target_user and session_id = target_session and consumed_at is null;
  insert into email_mfa_challenges (id, user_id, session_id, code_hash, expires_at)
  values (target_challenge, target_user, target_session, target_code_hash, target_expires_at);
  return 'created';
end;
$$;

create or replace function verify_email_mfa_challenge(
  target_challenge uuid, target_user uuid, target_session uuid, candidate_hash text
) returns text language plpgsql security definer set search_path = public
as $$
declare challenge email_mfa_challenges%rowtype;
begin
  select * into challenge from email_mfa_challenges
  where id = target_challenge and user_id = target_user and session_id = target_session for update;
  if not found or challenge.consumed_at is not null then return 'not_found'; end if;
  if challenge.expires_at <= now() then
    update email_mfa_challenges set consumed_at = now() where id = challenge.id;
    return 'expired';
  end if;
  if challenge.attempts >= 5 then
    update email_mfa_challenges set consumed_at = now() where id = challenge.id;
    return 'locked';
  end if;
  if challenge.code_hash <> candidate_hash then
    update email_mfa_challenges set attempts = attempts + 1,
      consumed_at = case when attempts + 1 >= 5 then now() else consumed_at end
    where id = challenge.id;
    return 'invalid';
  end if;
  update email_mfa_challenges set consumed_at = now() where id = challenge.id;
  return 'verified';
end;
$$;

revoke all on function create_email_mfa_challenge(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function verify_email_mfa_challenge(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function create_email_mfa_challenge(uuid, uuid, uuid, text, timestamptz) to service_role;
grant execute on function verify_email_mfa_challenge(uuid, uuid, uuid, text) to service_role;

-- Kategorie upominek zapamatovana pro odberatele podle ICO pri ulozeni OCR faktury.
create table counterparty_reminder_preferences (
  organization_id uuid not null references organizations(id) on delete cascade,
  counterparty_ico text not null check (counterparty_ico ~ '^[0-9]{8}$'),
  reminder_policy_id uuid not null,
  last_invoice_id uuid,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, counterparty_ico),
  constraint counterparty_reminder_preferences_policy_same_org_fkey
    foreign key (organization_id, reminder_policy_id)
    references reminder_policies (organization_id, id),
  constraint counterparty_reminder_preferences_invoice_same_org_fkey
    foreign key (organization_id, last_invoice_id)
    references invoices (organization_id, id) on delete set null (last_invoice_id)
);

create index counterparty_reminder_preferences_policy_idx
  on counterparty_reminder_preferences (organization_id, reminder_policy_id);
create index counterparty_reminder_preferences_invoice_idx
  on counterparty_reminder_preferences (organization_id, last_invoice_id);
create index counterparty_reminder_preferences_updated_by_idx
  on counterparty_reminder_preferences (updated_by);

alter table counterparty_reminder_preferences enable row level security;
revoke all on table counterparty_reminder_preferences from public, anon, authenticated;
grant select, insert, update, delete on table counterparty_reminder_preferences to service_role;

comment on table counterparty_reminder_preferences is
  'Internal per-organization OCR reminder policy preference keyed by normalized Czech ICO.';

create or replace function remember_ocr_reminder_policy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_ico text := regexp_replace(coalesce(new.counterparty_ico, ''), '[^0-9]', '', 'g');
  previous_ico text;
begin
  if tg_op = 'UPDATE' then
    previous_ico := regexp_replace(coalesce(old.counterparty_ico, ''), '[^0-9]', '', 'g');
    if previous_ico ~ '^[0-9]{8}$' and previous_ico is distinct from normalized_ico then
      delete from public.counterparty_reminder_preferences
      where organization_id = old.organization_id
        and counterparty_ico = previous_ico
        and last_invoice_id = old.id;
    end if;
  end if;

  if new.source = 'ocr'
    and normalized_ico ~ '^[0-9]{8}$'
    and new.reminder_policy_id is not null then
    insert into public.counterparty_reminder_preferences (
      organization_id, counterparty_ico, reminder_policy_id, last_invoice_id, updated_by
    ) values (
      new.organization_id, normalized_ico, new.reminder_policy_id, new.id,
      coalesce(new.updated_by, new.created_by)
    )
    on conflict (organization_id, counterparty_ico) do update
    set reminder_policy_id = excluded.reminder_policy_id,
        last_invoice_id = excluded.last_invoice_id,
        updated_by = excluded.updated_by,
        updated_at = now();
  end if;

  return new;
end;
$$;

revoke all on function remember_ocr_reminder_policy() from public, anon, authenticated;
grant execute on function remember_ocr_reminder_policy() to service_role;

create trigger remember_ocr_invoice_reminder_policy
after insert or update of reminder_policy_id, counterparty_ico on invoices
for each row execute function remember_ocr_reminder_policy();

-- Supporting indexes for foreign keys used by cascades, joins and organization filters.
create index bank_payments_imported_by_idx on bank_payments (imported_by);
create index bank_payments_org_invoice_idx on bank_payments (organization_id, invoice_id);
create index bank_payments_unmatched_by_idx on bank_payments (unmatched_by);
create index invoice_events_actor_user_id_idx on invoice_events (actor_user_id);
create index invoice_events_org_invoice_idx on invoice_events (organization_id, invoice_id);
create index invoice_uploads_created_by_idx on invoice_uploads (created_by);
create index invoice_uploads_invoice_id_idx on invoice_uploads (invoice_id);
create index invoice_uploads_org_invoice_idx on invoice_uploads (organization_id, invoice_id);
create index invoices_created_by_idx on invoices (created_by);
create index invoices_org_policy_idx on invoices (organization_id, reminder_policy_id);
create index invoices_reminder_policy_id_idx on invoices (reminder_policy_id);
create index invoices_reminders_paused_by_idx on invoices (reminders_paused_by);
create index invoices_updated_by_idx on invoices (updated_by);
create index organization_member_events_actor_idx on organization_member_events (actor_user_id);
create index organization_members_user_id_idx on organization_members (user_id);
create index reminder_automation_runs_triggered_by_idx on reminder_automation_runs (triggered_by);
create index reminder_log_org_invoice_idx on reminder_log (organization_id, invoice_id);
create index reminder_settings_events_actor_idx on reminder_settings_events (actor_user_id);

-- Internal tables are deliberately unavailable to browser roles even though RLS
-- without policies already denies access.
revoke all on table email_mfa_challenges from public, anon, authenticated;
revoke all on table provider_webhook_events from public, anon, authenticated;
comment on table email_mfa_challenges is
  'Internal email MFA challenges. Deliberately inaccessible to anon/authenticated roles.';
comment on table provider_webhook_events is
  'Internal idempotency log for signed provider webhooks. Deliberately inaccessible to browser roles.';

-- Persistent privacy-preserving rate-limit audit for public authentication routes.
create table auth_request_events (
  id bigint generated always as identity primary key,
  action text not null check (action in (
    'registration_access_ip',
    'registration_access_email',
    'password_recovery_ip',
    'password_recovery_email'
  )),
  subject_hash text not null check (length(subject_hash) = 64),
  allowed boolean not null,
  requested_at timestamptz not null default now()
);

alter table auth_request_events enable row level security;
revoke all on table auth_request_events from public, anon, authenticated;
grant select, insert, delete on table auth_request_events to service_role;
grant usage, select on sequence auth_request_events_id_seq to service_role;

create index auth_request_events_window_idx
  on auth_request_events (action, subject_hash, requested_at desc);
create index auth_request_events_retention_idx on auth_request_events (requested_at);

create or replace function consume_auth_rate_limit(
  target_action text,
  target_subject_hash text,
  target_max_attempts integer,
  target_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempts integer;
  accepted boolean;
begin
  if target_action not in (
    'registration_access_ip',
    'registration_access_email',
    'password_recovery_ip',
    'password_recovery_email'
  ) or target_subject_hash !~ '^[0-9a-f]{64}$'
    or target_max_attempts < 1 or target_max_attempts > 100
    or target_window_seconds < 60 or target_window_seconds > 86400 then
    raise exception 'invalid auth rate limit input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_action || ':' || target_subject_hash, 0));

  select count(*) into attempts
  from public.auth_request_events
  where action = target_action
    and subject_hash = target_subject_hash
    and allowed
    and requested_at >= now() - make_interval(secs => target_window_seconds);

  accepted := attempts < target_max_attempts;
  insert into public.auth_request_events (action, subject_hash, allowed)
  values (target_action, target_subject_hash, accepted);

  delete from public.auth_request_events
  where requested_at < now() - interval '30 days';

  return accepted;
end;
$$;

revoke all on function consume_auth_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function consume_auth_rate_limit(text, text, integer, integer) to service_role;

-- Consolidated from: 20260908154602_optimize_reminder_queue.sql
-- Durable reminder queue and per-phase operational metrics.
-- reminder_log stays the only queue; no Redis/PGMQ dependency is introduced.

alter table public.reminder_log
  add column if not exists available_at timestamptz,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz;

update public.reminder_log
set available_at = ((scheduled_for::timestamp + time '06:00') at time zone 'UTC')
where available_at is null;

alter table public.reminder_log
  alter column available_at set default now(),
  alter column available_at set not null;

alter table public.reminder_log
  drop constraint if exists reminder_log_lease_pair_check,
  add constraint reminder_log_lease_pair_check
    check ((lease_token is null) = (lease_expires_at is null));

alter table public.reminder_automation_runs
  add column if not exists queued integer not null default 0 check (queued >= 0),
  add column if not exists processed integer not null default 0 check (processed >= 0),
  add column if not exists remaining integer not null default 0 check (remaining >= 0),
  add column if not exists planner_duration_ms integer not null default 0 check (planner_duration_ms >= 0),
  add column if not exists worker_duration_ms integer not null default 0 check (worker_duration_ms >= 0);

create or replace function public.schedule_reminder_jobs(
  target_jobs jsonb,
  target_invoice_updates jsonb,
  target_now timestamptz default now()
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result jsonb;
begin
  if jsonb_typeof(coalesce(target_jobs, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(target_invoice_updates, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_queue_payload';
  end if;

  with parsed_jobs as (
    select *
    from jsonb_to_recordset(coalesce(target_jobs, '[]'::jsonb)) as job(
      organization_id uuid,
      invoice_id uuid,
      stage text,
      scheduled_for date,
      sent_to text,
      status text,
      available_at timestamptz
    )
    where status in ('queued', 'skipped')
  ), changed_jobs as (
    insert into public.reminder_log as existing (
      organization_id, invoice_id, stage, scheduled_for, sent_to, status,
      available_at, attempt_count, updated_at
    )
    select organization_id, invoice_id, stage, scheduled_for, lower(sent_to), status,
      available_at, 0, target_now
    from parsed_jobs
    on conflict (invoice_id, stage, scheduled_for) do update set
      status = excluded.status,
      sent_to = excluded.sent_to,
      available_at = excluded.available_at,
      error_message = null,
      lease_token = null,
      lease_expires_at = null,
      updated_at = target_now
    where
      (excluded.status = 'queued' and existing.status = 'failed' and existing.attempt_count < 3)
      or (
        excluded.status = 'skipped'
        and existing.status in ('failed', 'queued')
        and (existing.lease_expires_at is null or existing.lease_expires_at <= target_now)
      )
    returning status
  ), parsed_updates as (
    select *
    from jsonb_to_recordset(coalesce(target_invoice_updates, '[]'::jsonb)) as invoice_update(
      organization_id uuid,
      invoice_id uuid,
      next_reminder_at timestamptz
    )
  ), updated_invoices as (
    update public.invoices as invoice set
      next_reminder_at = invoice_update.next_reminder_at,
      updated_at = target_now
    from parsed_updates as invoice_update
    where invoice.id = invoice_update.invoice_id
      and invoice.organization_id = invoice_update.organization_id
      and invoice.status in ('pending', 'overdue')
    returning invoice.id
  )
  select jsonb_build_object(
    'queued', count(*) filter (where status = 'queued'),
    'skipped', count(*) filter (where status = 'skipped'),
    'updated_invoices', (select count(*) from updated_invoices)
  ) into result
  from changed_jobs;

  return coalesce(result, jsonb_build_object('queued', 0, 'skipped', 0, 'updated_invoices', 0));
end;
$$;

create or replace function public.claim_reminder_jobs(
  target_organizations uuid[],
  target_worker uuid,
  target_limit integer default 25,
  target_lease_seconds integer default 900,
  target_now timestamptz default now()
) returns table (
  id uuid,
  organization_id uuid,
  invoice_id uuid,
  stage text,
  scheduled_for date,
  attempt_count integer,
  lease_token uuid
)
language sql
security invoker
set search_path = ''
as $$
  with candidates as (
    select queue.id
    from public.reminder_log as queue
    where queue.organization_id = any(target_organizations)
      and queue.status = 'queued'
      and queue.available_at <= target_now
      and queue.attempt_count < 3
      and (queue.lease_expires_at is null or queue.lease_expires_at <= target_now)
    order by queue.scheduled_for, queue.id
    limit least(greatest(target_limit, 1), 25)
    for update skip locked
  ), claimed as (
    update public.reminder_log as queue set
      lease_token = target_worker,
      lease_expires_at = target_now + make_interval(secs => least(greatest(target_lease_seconds, 60), 3600)),
      attempt_count = queue.attempt_count + 1,
      updated_at = target_now
    from candidates
    where queue.id = candidates.id
    returning queue.id, queue.organization_id, queue.invoice_id, queue.stage,
      queue.scheduled_for, queue.attempt_count, queue.lease_token
  )
  select * from claimed order by scheduled_for, id;
$$;

create or replace function public.complete_claimed_reminder_send(
  target_log_id uuid,
  target_lease_token uuid,
  provider_id text,
  sent_time timestamptz,
  next_time timestamptz
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_invoice_id uuid;
begin
  update public.reminder_log set
    status = 'sent', sent_at = sent_time, provider_message_id = provider_id,
    delivery_status = 'accepted', delivery_event_at = sent_time,
    delivered_at = null, delivery_error = null, error_message = null,
    lease_token = null, lease_expires_at = null, updated_at = sent_time
  where id = target_log_id and status = 'queued' and lease_token = target_lease_token
  returning invoice_id into target_invoice_id;

  if target_invoice_id is null then return false; end if;

  update public.invoices set
    reminders_sent = reminders_sent + 1,
    last_reminder_at = sent_time,
    next_reminder_at = next_time,
    updated_at = sent_time
  where id = target_invoice_id and status in ('pending', 'overdue');

  return true;
end;
$$;

create or replace function public.fail_claimed_reminder_job(
  target_log_id uuid,
  target_lease_token uuid,
  failure_message text,
  retry_time timestamptz,
  failed_time timestamptz default now()
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_invoice_id uuid;
begin
  update public.reminder_log set
    status = 'failed', error_message = left(failure_message, 1000),
    lease_token = null, lease_expires_at = null, updated_at = failed_time
  where id = target_log_id and status = 'queued' and lease_token = target_lease_token
  returning invoice_id into target_invoice_id;

  if target_invoice_id is null then return false; end if;
  update public.invoices set next_reminder_at = retry_time, updated_at = failed_time
  where id = target_invoice_id and status in ('pending', 'overdue') and reminders_paused = false;
  return true;
end;
$$;

create or replace function public.skip_claimed_reminder_job(
  target_log_id uuid,
  target_lease_token uuid,
  skipped_time timestamptz default now()
) returns boolean
language sql
security invoker
set search_path = ''
as $$
  update public.reminder_log set
    status = 'skipped', error_message = null,
    lease_token = null, lease_expires_at = null, updated_at = skipped_time
  where id = target_log_id and status = 'queued' and lease_token = target_lease_token
  returning true;
$$;

create or replace function public.release_claimed_reminder_jobs(
  target_lease_token uuid,
  target_log_ids uuid[],
  released_time timestamptz default now()
) returns integer
language sql
security invoker
set search_path = ''
as $$
  with released as (
    update public.reminder_log set
      lease_token = null,
      lease_expires_at = null,
      attempt_count = greatest(attempt_count - 1, 0),
      updated_at = released_time
    where id = any(target_log_ids)
      and status = 'queued'
      and lease_token = target_lease_token
    returning id
  )
  select count(*)::integer from released;
$$;

revoke all on function public.schedule_reminder_jobs(jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_reminder_jobs(uuid[], uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_claimed_reminder_send(uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_claimed_reminder_job(uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.skip_claimed_reminder_job(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.release_claimed_reminder_jobs(uuid, uuid[], timestamptz) from public, anon, authenticated;

grant execute on function public.schedule_reminder_jobs(jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.claim_reminder_jobs(uuid[], uuid, integer, integer, timestamptz) to service_role;
grant execute on function public.complete_claimed_reminder_send(uuid, uuid, text, timestamptz, timestamptz) to service_role;
grant execute on function public.fail_claimed_reminder_job(uuid, uuid, text, timestamptz, timestamptz) to service_role;
grant execute on function public.skip_claimed_reminder_job(uuid, uuid, timestamptz) to service_role;
grant execute on function public.release_claimed_reminder_jobs(uuid, uuid[], timestamptz) to service_role;
