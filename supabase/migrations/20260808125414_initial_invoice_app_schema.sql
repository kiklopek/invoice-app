-- Consolidated from: 2026080601_invoice_reminder_controls.sql

-- Ovládání automatických upomínek pro jednotlivé faktury.
alter table invoices
  add column if not exists reminders_paused boolean not null default false,
  add column if not exists reminders_paused_at timestamptz,
  add column if not exists reminders_paused_by uuid references auth.users(id) on delete set null;

-- Při změně globálního plánu se ručně pozastavené faktury nesmí znovu aktivovat.
create or replace function save_default_reminder_settings(
  target_org uuid,
  new_days integer[],
  template_data jsonb,
  new_active boolean
) returns void language plpgsql security definer set search_path = public
as $$
declare
  target_policy_id uuid;
  company_today date := (now() at time zone 'Europe/Prague')::date;
begin
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

  insert into email_templates (organization_id, stage, subject, body, updated_at)
  select target_org, item.key, item.value ->> 'subject', item.value ->> 'body', now()
  from jsonb_each(template_data) item
  where item.key in ('before_due', 'on_due', 'overdue', 'escalation')
  on conflict (organization_id, stage) do update
    set subject = excluded.subject, body = excluded.body, updated_at = excluded.updated_at;

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
end;
$$;

revoke all on function save_default_reminder_settings(uuid, integer[], jsonb, boolean) from public, anon, authenticated;
grant execute on function save_default_reminder_settings(uuid, integer[], jsonb, boolean) to service_role;


-- Consolidated from: 2026080602_invoice_audit_log.sql

-- Nezávislá, databázově vynucená historie změn faktur.
alter table invoices
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

create table if not exists invoice_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'created', 'updated', 'paid', 'reopened', 'cancelled', 'overdue',
    'reminders_paused', 'reminders_resumed'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists invoice_events_invoice on invoice_events (invoice_id, created_at desc);

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
      jsonb_build_object('from', old.status, 'to', new.status, 'paid_at', new.paid_at)
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

drop trigger if exists invoices_audit_change on invoices;
create trigger invoices_audit_change
after insert or update on invoices
for each row execute function audit_invoice_change();

revoke all on function audit_invoice_change() from public, anon, authenticated;
alter table invoice_events enable row level security;
revoke insert, update, delete on invoice_events from anon, authenticated;

drop policy if exists "members can view invoice events" on invoice_events;
create policy "members can view invoice events" on invoice_events for select
  using (is_org_member(organization_id));


-- Consolidated from: 2026080603_bank_payment_reconciliation.sql

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


-- Consolidated from: 2026080604_resend_delivery_tracking.sql

-- Doručení, bounce/complaint suppression a idempotentní Resend webhooky.
alter table reminder_log
  add column if not exists delivery_status text check (delivery_status is null or delivery_status in ('accepted', 'delivered', 'delayed', 'bounced', 'complained', 'failed')),
  add column if not exists delivery_event_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_error text;

create index if not exists reminder_log_provider_message on reminder_log (provider_message_id) where provider_message_id is not null;

create table if not exists provider_webhook_events (
  event_id text primary key,
  event_type text not null check (event_type in ('email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed')),
  provider_message_id text not null,
  event_at timestamptz not null,
  received_at timestamptz not null default now()
);

create table if not exists email_suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null check (email = lower(email)),
  reason text not null check (reason in ('bounced', 'complained')),
  provider_message_id text,
  last_event_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);
create index if not exists email_suppressions_org on email_suppressions (organization_id, email);

create or replace function complete_reminder_send(
  target_log_id uuid, provider_id text, sent_time timestamptz, next_time timestamptz
) returns boolean language plpgsql security definer set search_path = public
as $$
declare target_invoice_id uuid;
begin
  update reminder_log set status = 'sent', sent_at = sent_time, provider_message_id = provider_id,
    delivery_status = 'accepted', delivery_event_at = sent_time, delivered_at = null, delivery_error = null,
    error_message = null, updated_at = sent_time
  where id = target_log_id and status = 'queued'
  returning invoice_id into target_invoice_id;
  if target_invoice_id is null then return false; end if;
  update invoices set reminders_sent = reminders_sent + 1, last_reminder_at = sent_time,
    next_reminder_at = next_time, updated_at = sent_time where id = target_invoice_id;
  return found;
end;
$$;
revoke all on function complete_reminder_send(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function complete_reminder_send(uuid, text, timestamptz, timestamptz) to service_role;

create or replace function process_resend_delivery_event(
  webhook_event_id text, webhook_event_type text, message_id text, event_time timestamptz, event_error text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare target_log reminder_log%rowtype; normalized_status text; was_duplicate boolean;
begin
  if webhook_event_type not in ('email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed')
    or length(webhook_event_id) not between 1 and 200 or length(message_id) not between 1 and 200 then
    raise exception 'invalid resend webhook event';
  end if;
  insert into provider_webhook_events (event_id, event_type, provider_message_id, event_at)
  values (webhook_event_id, webhook_event_type, message_id, event_time) on conflict (event_id) do nothing;
  was_duplicate := not found;
  normalized_status := case webhook_event_type when 'email.sent' then 'accepted' when 'email.delivered' then 'delivered'
    when 'email.delivery_delayed' then 'delayed' when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained' when 'email.failed' then 'failed' end;
  select * into target_log from reminder_log where provider_message_id = message_id order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('duplicate', was_duplicate, 'matched', false); end if;
  if target_log.delivery_event_at is null or event_time >= target_log.delivery_event_at then
    update reminder_log set delivery_status = normalized_status, delivery_event_at = event_time,
      delivered_at = case when webhook_event_type = 'email.delivered' then event_time else delivered_at end,
      delivery_error = case when webhook_event_type in ('email.bounced', 'email.complained', 'email.failed', 'email.delivery_delayed')
        then nullif(left(coalesce(event_error, ''), 1000), '') else null end,
      updated_at = now() where id = target_log.id;
  end if;
  if webhook_event_type in ('email.bounced', 'email.complained') then
    insert into email_suppressions (organization_id, email, reason, provider_message_id, last_event_at)
    values (target_log.organization_id, lower(target_log.sent_to), case when webhook_event_type = 'email.bounced' then 'bounced' else 'complained' end, message_id, event_time)
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
alter table provider_webhook_events enable row level security;
alter table email_suppressions enable row level security;
revoke all on provider_webhook_events from anon, authenticated;
revoke insert, update, delete on email_suppressions from anon, authenticated;
drop policy if exists "members can view email suppressions" on email_suppressions;
create policy "members can view email suppressions" on email_suppressions for select using (is_org_member(organization_id));


-- Consolidated from: 2026080605_invoice_ocr.sql

-- Bezpečný stav a nákladový limit multimodálního OCR.
alter table invoice_uploads
  add column if not exists ocr_status text not null default 'idle' check (ocr_status in ('idle', 'processing', 'succeeded', 'failed')),
  add column if not exists ocr_attempt_count integer not null default 0 check (ocr_attempt_count between 0 and 3),
  add column if not exists ocr_started_at timestamptz,
  add column if not exists ocr_completed_at timestamptz,
  add column if not exists ocr_error text,
  add column if not exists ocr_model text,
  add column if not exists ocr_provider_response_id text;

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


-- Consolidated from: 2026080606_resend_webhook_race_fix.sql

-- Retry stejného webhook ID musí znovu zkusit párování, pokud webhook předběhl zápis odeslání.
create or replace function process_resend_delivery_event(
  webhook_event_id text, webhook_event_type text, message_id text, event_time timestamptz, event_error text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare target_log reminder_log%rowtype; normalized_status text; was_duplicate boolean;
begin
  if webhook_event_type not in ('email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed')
    or length(webhook_event_id) not between 1 and 200 or length(message_id) not between 1 and 200 then
    raise exception 'invalid resend webhook event';
  end if;
  insert into provider_webhook_events (event_id, event_type, provider_message_id, event_at)
  values (webhook_event_id, webhook_event_type, message_id, event_time) on conflict (event_id) do nothing;
  was_duplicate := not found;
  normalized_status := case webhook_event_type when 'email.sent' then 'accepted' when 'email.delivered' then 'delivered'
    when 'email.delivery_delayed' then 'delayed' when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained' when 'email.failed' then 'failed' end;
  select * into target_log from reminder_log where provider_message_id = message_id order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('duplicate', was_duplicate, 'matched', false); end if;
  if target_log.delivery_event_at is null or event_time >= target_log.delivery_event_at then
    update reminder_log set delivery_status = normalized_status, delivery_event_at = event_time,
      delivered_at = case when webhook_event_type = 'email.delivered' then event_time else delivered_at end,
      delivery_error = case when webhook_event_type in ('email.bounced', 'email.complained', 'email.failed', 'email.delivery_delayed')
        then nullif(left(coalesce(event_error, ''), 1000), '') else null end,
      updated_at = now() where id = target_log.id;
  end if;
  if webhook_event_type in ('email.bounced', 'email.complained') then
    insert into email_suppressions (organization_id, email, reason, provider_message_id, last_event_at)
    values (target_log.organization_id, lower(target_log.sent_to), case when webhook_event_type = 'email.bounced' then 'bounced' else 'complained' end, message_id, event_time)
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


-- Consolidated from: 2026080607_atomic_admin_management.sql

-- Atomická ochrana posledního administrátora i při souběžných požadavcích.
create or replace function update_organization_member_role(
  target_org uuid, target_member uuid, new_role text, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare current_role text; member_email text; member_user uuid; member_created timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  if new_role not in ('viewer', 'accounting', 'admin') then raise exception 'invalid_role'; end if;
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user and role = 'admin') then raise exception 'insufficient_permission'; end if;
  select role, email, user_id, created_at into current_role, member_email, member_user, member_created
  from organization_members where id = target_member and organization_id = target_org for update;
  if not found then raise exception 'member_not_found'; end if;
  if current_role = 'admin' and new_role <> 'admin'
    and (select count(*) from organization_members where organization_id = target_org and role = 'admin') <= 1 then raise exception 'last_admin'; end if;
  update organization_members set role = new_role where id = target_member;
  return jsonb_build_object('id', target_member, 'email', member_email, 'role', new_role, 'user_id', member_user, 'created_at', member_created);
end;
$$;

create or replace function delete_organization_member(
  target_org uuid, target_member uuid, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare current_role text; member_user uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user and role = 'admin') then raise exception 'insufficient_permission'; end if;
  select role, user_id into current_role, member_user from organization_members where id = target_member and organization_id = target_org for update;
  if not found then raise exception 'member_not_found'; end if;
  if member_user = actor_user then raise exception 'cannot_remove_self'; end if;
  if current_role = 'admin'
    and (select count(*) from organization_members where organization_id = target_org and role = 'admin') <= 1 then raise exception 'last_admin'; end if;
  delete from organization_members where id = target_member and organization_id = target_org;
  return jsonb_build_object('removed', true, 'id', target_member);
end;
$$;

revoke all on function update_organization_member_role(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function delete_organization_member(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function update_organization_member_role(uuid, uuid, text, uuid) to service_role;
grant execute on function delete_organization_member(uuid, uuid, uuid) to service_role;


-- Consolidated from: 2026080608_reminder_automation_runs.sql

-- Per-organization operational history for the scheduled reminder worker.
create table if not exists reminder_automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  run_key uuid not null,
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
  check ((status = 'running' and finished_at is null) or (status <> 'running' and finished_at is not null))
);

create index if not exists reminder_automation_runs_org_started
  on reminder_automation_runs (organization_id, started_at desc);

alter table reminder_automation_runs enable row level security;
revoke insert, update, delete on reminder_automation_runs from anon, authenticated;

drop policy if exists "members can view reminder automation runs" on reminder_automation_runs;
create policy "members can view reminder automation runs" on reminder_automation_runs for select
  using (is_org_member(organization_id));


-- Consolidated from: 2026080609_atomic_payment_reopen.sql

-- Prevent two full payments from being attached to the same invoice and make
-- correction of a mistaken bank match atomic with reopening the invoice.
alter table bank_payments add column if not exists unmatched_at timestamptz;
alter table bank_payments add column if not exists unmatched_by uuid references auth.users(id) on delete set null;

alter table bank_payments drop constraint if exists bank_payments_match_consistency;
alter table bank_payments add constraint bank_payments_match_consistency check (
  (match_status = 'matched' and invoice_id is not null and matched_at is not null)
  or (match_status <> 'matched' and invoice_id is null)
) not valid;
alter table bank_payments validate constraint bank_payments_match_consistency;

create unique index if not exists bank_payments_one_match_per_invoice
  on bank_payments (invoice_id) where invoice_id is not null and match_status = 'matched';

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
  update bank_payments set invoice_id = selected_invoice.id, match_status = 'matched', matched_at = now(), unmatched_at = null, unmatched_by = null
  where id = selected_payment.id;
  update invoices set status = 'paid', paid_at = (selected_payment.booked_on + time '12:00') at time zone 'Europe/Prague',
    next_reminder_at = null, updated_by = actor_user, updated_at = now() where id = selected_invoice.id;
  return jsonb_build_object('payment_id', selected_payment.id, 'invoice_id', selected_invoice.id,
    'invoice_number', selected_invoice.invoice_number, 'status', 'matched');
end;
$$;

create or replace function reopen_paid_invoice(
  target_org uuid, target_invoice uuid, actor_user uuid, new_status text, next_time timestamptz
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare selected_invoice invoices%rowtype; reopened_invoice invoices%rowtype; detached_count integer := 0;
begin
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user and role in ('accounting', 'admin')) then
    raise exception 'insufficient_permission';
  end if;
  if new_status not in ('pending', 'overdue') then raise exception 'invalid_reopen_status'; end if;
  select * into selected_invoice from invoices where id = target_invoice and organization_id = target_org for update;
  if not found then raise exception 'invoice_not_found'; end if;
  if selected_invoice.status <> 'paid' then raise exception 'invoice_not_paid'; end if;

  update bank_payments set invoice_id = null, match_status = 'unmatched', matched_at = null,
    unmatched_at = now(), unmatched_by = actor_user
  where organization_id = target_org and invoice_id = target_invoice and match_status = 'matched';
  get diagnostics detached_count = row_count;

  update invoices set status = new_status, paid_at = null, next_reminder_at = next_time,
    updated_by = actor_user, updated_at = now()
  where id = target_invoice and organization_id = target_org returning * into reopened_invoice;

  update reminder_log set status = 'failed',
    error_message = 'Faktura byla znovu otevřena; krok čeká na nové vyhodnocení.', updated_at = now()
  where invoice_id = target_invoice and status = 'skipped' and sent_at is null;

  update invoice_events set details = details || jsonb_build_object(
    'paid_at', selected_invoice.paid_at, 'detached_payments', detached_count
  ) where id = (
    select id from invoice_events where invoice_id = target_invoice and event_type = 'reopened'
    order by created_at desc limit 1
  );

  return jsonb_build_object('invoice', to_jsonb(reopened_invoice), 'detached_payments', detached_count);
end;
$$;

revoke all on function assign_bank_payment(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function assign_bank_payment(uuid, uuid, uuid, uuid) to service_role;
revoke all on function reopen_paid_invoice(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function reopen_paid_invoice(uuid, uuid, uuid, text, timestamptz) to service_role;


-- Consolidated from: 2026080610_paginated_invoice_list.sql

-- Database-side invoice filtering, summaries and bounded pagination.
create or replace function list_invoices_page(
  target_org uuid, actor_user uuid, search_query text default null,
  status_filter text default null, currency_filter text default null,
  issue_from date default null, issue_to date default null,
  page_number integer default 1, page_size integer default 25
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user) then
    raise exception 'insufficient_permission';
  end if;
  if page_number < 1 or page_size < 1 or page_size > 500 then raise exception 'invalid_pagination'; end if;
  if status_filter is not null and status_filter not in ('pending', 'overdue', 'paid', 'cancelled') then raise exception 'invalid_status'; end if;
  if currency_filter is not null and currency_filter !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;
  if issue_from is not null and issue_to is not null and issue_from > issue_to then raise exception 'invalid_period'; end if;

  with filtered as materialized (
    select i.* from invoices i
    where i.organization_id = target_org
      and (status_filter is null or i.status = status_filter)
      and (currency_filter is null or i.currency = currency_filter)
      and (issue_from is null or i.issue_date >= issue_from)
      and (issue_to is null or i.issue_date <= issue_to)
      and (nullif(trim(search_query), '') is null
        or i.invoice_number ilike '%' || trim(search_query) || '%'
        or i.counterparty_name ilike '%' || trim(search_query) || '%'
        or i.counterparty_email ilike '%' || trim(search_query) || '%'
        or coalesce(i.variable_symbol, '') ilike '%' || trim(search_query) || '%')
  ), paged as (
    select * from filtered order by due_date asc, id asc
    offset (page_number - 1) * page_size limit page_size
  ), totals as (
    select currency, sum(amount) as amount from filtered
    where status in ('pending', 'overdue') group by currency
  ), available_currencies as (
    select distinct currency from invoices where organization_id = target_org
  )
  select jsonb_build_object(
    'invoices', coalesce((select jsonb_agg(to_jsonb(p) order by p.due_date, p.id) from paged p), '[]'::jsonb),
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

-- Consolidated from: 2026080611_server_report_aggregation.sql

-- Server-side report aggregation and bounded export pages.
create index if not exists invoices_report_issue on invoices (organization_id, currency, issue_date);
create index if not exists invoices_report_due on invoices (organization_id, currency, due_date);
create index if not exists invoices_report_paid on invoices (organization_id, currency, ((paid_at at time zone 'Europe/Prague')::date));
create index if not exists invoices_report_customer on invoices (organization_id, counterparty_name);

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
    select i.* from invoices i where i.organization_id = target_org and i.currency = currency_filter
      and (status_filter is null or i.status = status_filter) and (customer_filter is null or i.counterparty_name = customer_filter)
      and ((date_basis = 'issue_date' and i.issue_date between report_from and report_to)
        or (date_basis = 'due_date' and i.due_date between report_from and report_to)
        or (date_basis = 'paid_at' and (i.paid_at at time zone 'Europe/Prague')::date between report_from and report_to))
  ), aging_values as (
    select case when as_of_date - due_date <= 0 then 0 when as_of_date - due_date <= 7 then 1 when as_of_date - due_date <= 14 then 2 when as_of_date - due_date <= 30 then 3 else 4 end as bucket,
      sum(amount) as amount, count(*) as count from filtered where status in ('pending', 'overdue') group by 1
  ), monthly_values as (
    select to_char(issue_date, 'YYYY-MM') as month_key, sum(amount) as issued, coalesce(sum(amount) filter (where status = 'paid'), 0) as paid from filtered group by 1
  ), debtor_values as (
    select counterparty_name as name, sum(amount) as open, coalesce(sum(amount) filter (where status = 'overdue'), 0) as overdue,
      count(*) as count, sum(reminders_sent) as reminders from filtered where status in ('pending', 'overdue') group by counterparty_name
  )
  select jsonb_build_object(
    'invoice_count', (select count(*) from filtered), 'total', coalesce((select sum(amount) from filtered), 0),
    'paid', coalesce((select sum(amount) from filtered where status = 'paid'), 0),
    'overdue', coalesce((select sum(amount) from filtered where status = 'overdue'), 0),
    'open', coalesce((select sum(amount) from filtered where status in ('pending', 'overdue')), 0),
    'paid_rate', coalesce((select round(100 * coalesce(sum(amount) filter (where status = 'paid'), 0) / nullif(coalesce(sum(amount) filter (where status <> 'cancelled'), 0), 0)) from filtered), 0)::integer,
    'counts', jsonb_build_object('pending', (select count(*) from filtered where status = 'pending'), 'overdue', (select count(*) from filtered where status = 'overdue'), 'paid', (select count(*) from filtered where status = 'paid'), 'cancelled', (select count(*) from filtered where status = 'cancelled')),
    'aging', coalesce((select jsonb_agg(jsonb_build_object('label', case g.bucket when 0 then 'Před splatností' when 1 then '1–7 dní' when 2 then '8–14 dní' when 3 then '15–30 dní' else 'Více než 30 dní' end, 'amount', coalesce(a.amount, 0), 'count', coalesce(a.count, 0)) order by g.bucket) from generate_series(0, 4) g(bucket) left join aging_values a using (bucket)), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('key', month_key, 'issued', issued, 'paid', paid) order by month_key) from monthly_values), '[]'::jsonb),
    'debtors', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'open', open, 'overdue', overdue, 'count', count, 'reminders', reminders) order by open desc, name) from debtor_values), '[]'::jsonb),
    'currencies', coalesce((select jsonb_agg(currency order by currency) from (select distinct currency from invoices where organization_id = target_org) c), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(counterparty_name order by counterparty_name) from (select distinct counterparty_name from invoices where organization_id = target_org) n), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function invoice_report_rows_page(
  target_org uuid, actor_user uuid, report_from date, report_to date, date_basis text,
  currency_filter text, status_filter text default null, customer_filter text default null,
  page_number integer default 1, page_size integer default 500
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user) then raise exception 'insufficient_permission'; end if;
  if report_from > report_to or page_number < 1 or page_size < 1 or page_size > 500 then raise exception 'invalid_request'; end if;
  if date_basis not in ('issue_date', 'due_date', 'paid_at') or currency_filter !~ '^[A-Z]{3}$' then raise exception 'invalid_filter'; end if;
  if status_filter is not null and status_filter not in ('pending', 'overdue', 'paid', 'cancelled') then raise exception 'invalid_status'; end if;
  with filtered as materialized (
    select i.invoice_number, i.counterparty_name, i.amount, i.currency, i.issue_date, i.due_date, i.paid_at, i.status, i.reminders_sent, i.id
    from invoices i where i.organization_id = target_org and i.currency = currency_filter
      and (status_filter is null or i.status = status_filter) and (customer_filter is null or i.counterparty_name = customer_filter)
      and ((date_basis = 'issue_date' and i.issue_date between report_from and report_to)
        or (date_basis = 'due_date' and i.due_date between report_from and report_to)
        or (date_basis = 'paid_at' and (i.paid_at at time zone 'Europe/Prague')::date between report_from and report_to))
  ), paged as (select * from filtered order by issue_date, id offset (page_number - 1) * page_size limit page_size)
  select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(p) order by p.issue_date, p.id) from paged p), '[]'::jsonb), 'total', (select count(*) from filtered)) into result;
  return result;
end;
$$;

revoke all on function invoice_report_summary(uuid, uuid, date, date, text, text, text, text, date) from public, anon, authenticated;
grant execute on function invoice_report_summary(uuid, uuid, date, date, text, text, text, text, date) to service_role;
revoke all on function invoice_report_rows_page(uuid, uuid, date, date, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function invoice_report_rows_page(uuid, uuid, date, date, text, text, text, text, integer, integer) to service_role;


-- Consolidated from: 2026080612_dashboard_summary.sql

-- Bounded dashboard payload: aggregates plus only the visible recent and upcoming rows.
create index if not exists invoices_org_created on invoices (organization_id, created_at desc, id desc);
create index if not exists invoices_org_next_reminder on invoices (organization_id, next_reminder_at, id)
  where status in ('pending', 'overdue') and next_reminder_at is not null;

create or replace function dashboard_summary(target_org uuid, actor_user uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user) then
    raise exception 'insufficient_permission';
  end if;

  with currency_totals as (
    select currency,
      coalesce(sum(amount) filter (where status in ('pending', 'overdue')), 0) as open_amount,
      coalesce(sum(amount) filter (where status = 'overdue'), 0) as overdue_amount,
      coalesce(sum(amount) filter (where status = 'paid'), 0) as paid_amount
    from invoices where organization_id = target_org group by currency
  ), recent as (
    select id, invoice_number, variable_symbol, counterparty_name, counterparty_email,
      amount, currency, due_date, status, reminders_sent, created_at
    from invoices where organization_id = target_org
    order by created_at desc, id desc limit 5
  ), upcoming as (
    select id, invoice_number, counterparty_name, amount, currency, status, next_reminder_at
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


-- Consolidated from: 2026080613_tenant_integrity.sql

-- Defense in depth: organization_id must agree across every invoice-owned relation.
-- Existing single-column foreign keys remain responsible for their ON DELETE actions;
-- these composite keys prevent accidental cross-organization links.
alter table reminder_policies
  add constraint reminder_policies_org_id_key unique (organization_id, id);
alter table invoices
  add constraint invoices_org_id_key unique (organization_id, id);

alter table invoices
  add constraint invoices_policy_same_org_fkey
  foreign key (organization_id, reminder_policy_id)
  references reminder_policies (organization_id, id) not valid;
alter table invoice_events
  add constraint invoice_events_invoice_same_org_fkey
  foreign key (organization_id, invoice_id)
  references invoices (organization_id, id) not valid;
alter table invoice_uploads
  add constraint invoice_uploads_invoice_same_org_fkey
  foreign key (organization_id, invoice_id)
  references invoices (organization_id, id) not valid;
alter table reminder_log
  add constraint reminder_log_invoice_same_org_fkey
  foreign key (organization_id, invoice_id)
  references invoices (organization_id, id) not valid;
alter table bank_payments
  add constraint bank_payments_invoice_same_org_fkey
  foreign key (organization_id, invoice_id)
  references invoices (organization_id, id) not valid;

-- A paid timestamp and an active reminder schedule must always agree with invoice status.
alter table invoices
  add constraint invoices_paid_state_check
  check ((status = 'paid') = (paid_at is not null)) not valid;
alter table invoices
  add constraint invoices_closed_schedule_check
  check (status in ('pending', 'overdue') or next_reminder_at is null) not valid;

-- Only a completed send may carry sent/provider timestamps. Failed, skipped and leased
-- rows remain unsent and can therefore be retried without ambiguous database state.
alter table reminder_log
  add constraint reminder_log_sent_state_check
  check ((status = 'sent') = (sent_at is not null)) not valid;
alter table reminder_log
  add constraint reminder_log_provider_state_check
  check (provider_message_id is null or status = 'sent') not valid;

alter table invoices validate constraint invoices_policy_same_org_fkey;
alter table invoice_events validate constraint invoice_events_invoice_same_org_fkey;
alter table invoice_uploads validate constraint invoice_uploads_invoice_same_org_fkey;
alter table reminder_log validate constraint reminder_log_invoice_same_org_fkey;
alter table bank_payments validate constraint bank_payments_invoice_same_org_fkey;
alter table invoices validate constraint invoices_paid_state_check;
alter table invoices validate constraint invoices_closed_schedule_check;
alter table reminder_log validate constraint reminder_log_sent_state_check;
alter table reminder_log validate constraint reminder_log_provider_state_check;


-- Consolidated from: 2026080614_reminder_settings_audit.sql

-- Immutable audit snapshots for every change to automated reminder timing/templates.
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

alter table reminder_settings_events enable row level security;
revoke insert, update, delete on reminder_settings_events from anon, authenticated;
create policy "members can view reminder settings events" on reminder_settings_events for select
  using (is_org_member(organization_id));

revoke all on function save_default_reminder_settings(uuid, integer[], jsonb, boolean) from public, anon, authenticated, service_role;
drop function save_default_reminder_settings(uuid, integer[], jsonb, boolean);

create function save_default_reminder_settings(
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
begin
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role in ('accounting', 'admin');
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;

  if new_days is null or cardinality(new_days) < 1 or cardinality(new_days) > 10
    or exists (select 1 from unnest(new_days) as offsets(day_value) where day_value < -90 or day_value > 365)
    or (select count(distinct day_value) from unnest(new_days) as offsets(day_value)) <> cardinality(new_days) then
    raise exception 'invalid_days';
  end if;
  if template_data is null or jsonb_typeof(template_data) <> 'object'
    or exists (
      select 1 from unnest(array['before_due', 'on_due', 'overdue', 'escalation']) as stages(stage_name)
      where not (template_data ? stage_name)
        or jsonb_typeof(template_data -> stage_name) <> 'object'
        or coalesce(length(trim(template_data -> stage_name ->> 'subject')), 0) not between 1 and 300
        or coalesce(length(trim(template_data -> stage_name ->> 'body')), 0) not between 1 and 20000
    ) then raise exception 'invalid_templates';
  end if;

  select id into target_policy_id from reminder_policies
  where organization_id = target_org and is_default for update;

  if target_policy_id is null then
    insert into reminder_policies (organization_id, name, is_default, days_from_due, is_active)
    values (target_org, 'Výchozí upomínky', true, new_days, new_active)
    returning id into target_policy_id;
  else
    update reminder_policies set days_from_due = new_days, is_active = new_active, updated_at = now()
    where id = target_policy_id;
  end if;

  insert into email_templates (organization_id, stage, subject, body, updated_at)
  select target_org, item.key, trim(item.value ->> 'subject'), trim(item.value ->> 'body'), now()
  from jsonb_each(template_data) item
  where item.key in ('before_due', 'on_due', 'overdue', 'escalation')
  on conflict (organization_id, stage) do update
    set subject = excluded.subject, body = excluded.body, updated_at = excluded.updated_at;

  update invoices invoice set
    reminder_policy_id = target_policy_id,
    next_reminder_at = case when not new_active or invoice.reminders_paused then null else (
      select case
        when count(*) filter (where invoice.due_date + offset_day <= company_today) > 0
          then (company_today + time '06:00') at time zone 'Europe/Prague'
        else ((min(invoice.due_date + offset_day)) + time '06:00') at time zone 'Europe/Prague'
      end from unnest(new_days) offset_day
    ) end,
    updated_at = now()
  where invoice.organization_id = target_org and invoice.status in ('pending', 'overdue')
    and (invoice.reminder_policy_id is null or invoice.reminder_policy_id = target_policy_id);

  insert into reminder_settings_events (
    organization_id, actor_user_id, actor_email, is_active, days_from_due, template_data
  ) values (
    target_org, actor_user, actor_email_value, new_active, new_days, template_data
  ) returning id, created_at into event_id, event_created_at;

  return jsonb_build_object('id', event_id, 'changed_at', event_created_at, 'changed_by', actor_email_value);
end;
$$;

grant execute on function save_default_reminder_settings(uuid, integer[], jsonb, boolean, uuid) to service_role;


-- Consolidated from: 2026080615_access_audit.sql

-- Immutable access-management audit. Every membership mutation is performed and
-- recorded in one transaction under the organization advisory lock.
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

alter table organization_member_events enable row level security;
revoke insert, update, delete on organization_member_events from anon, authenticated;
create policy "members can view organization member events" on organization_member_events for select
  using (is_org_member(organization_id));

create or replace function add_organization_member(
  target_org uuid, new_email text, new_role text, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  actor_email_value text;
  member_id uuid;
  member_created timestamptz;
  event_id uuid;
  event_created timestamptz;
  normalized_email text := lower(trim(new_email));
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  if new_role not in ('viewer', 'accounting', 'admin') then raise exception 'invalid_role'; end if;
  if length(normalized_email) < 3 or length(normalized_email) > 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid_email'; end if;
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin';
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;

  insert into organization_members (organization_id, email, role)
  values (target_org, normalized_email, new_role)
  returning id, created_at into member_id, member_created;

  insert into organization_member_events (
    organization_id, actor_user_id, actor_email, target_member_id, target_email, event_type, new_role
  ) values (
    target_org, actor_user, actor_email_value, member_id, normalized_email, 'added', new_role
  ) returning id, created_at into event_id, event_created;

  return jsonb_build_object(
    'member', jsonb_build_object('id', member_id, 'email', normalized_email, 'role', new_role, 'user_id', null, 'created_at', member_created),
    'event', jsonb_build_object('id', event_id, 'actor_email', actor_email_value, 'target_email', normalized_email,
      'event_type', 'added', 'previous_role', null, 'new_role', new_role, 'created_at', event_created)
  );
end;
$$;

create or replace function update_organization_member_role(
  target_org uuid, target_member uuid, new_role text, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  current_role text;
  member_email text;
  member_user uuid;
  member_created timestamptz;
  actor_email_value text;
  event_id uuid;
  event_created timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  if new_role not in ('viewer', 'accounting', 'admin') then raise exception 'invalid_role'; end if;
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin';
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;
  select role, email, user_id, created_at into current_role, member_email, member_user, member_created
  from organization_members where id = target_member and organization_id = target_org for update;
  if not found then raise exception 'member_not_found'; end if;
  if current_role = 'admin' and new_role <> 'admin'
    and (select count(*) from organization_members where organization_id = target_org and role = 'admin') <= 1 then raise exception 'last_admin'; end if;

  update organization_members set role = new_role where id = target_member;
  insert into organization_member_events (
    organization_id, actor_user_id, actor_email, target_member_id, target_email, event_type, previous_role, new_role
  ) values (
    target_org, actor_user, actor_email_value, target_member, member_email, 'role_changed', current_role, new_role
  ) returning id, created_at into event_id, event_created;

  return jsonb_build_object(
    'member', jsonb_build_object('id', target_member, 'email', member_email, 'role', new_role, 'user_id', member_user, 'created_at', member_created),
    'event', jsonb_build_object('id', event_id, 'actor_email', actor_email_value, 'target_email', member_email,
      'event_type', 'role_changed', 'previous_role', current_role, 'new_role', new_role, 'created_at', event_created)
  );
end;
$$;

create or replace function delete_organization_member(
  target_org uuid, target_member uuid, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  current_role text;
  member_user uuid;
  member_email text;
  actor_email_value text;
  event_id uuid;
  event_created timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin';
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;
  select role, user_id, email into current_role, member_user, member_email
  from organization_members where id = target_member and organization_id = target_org for update;
  if not found then raise exception 'member_not_found'; end if;
  if member_user = actor_user then raise exception 'cannot_remove_self'; end if;
  if current_role = 'admin'
    and (select count(*) from organization_members where organization_id = target_org and role = 'admin') <= 1 then raise exception 'last_admin'; end if;

  insert into organization_member_events (
    organization_id, actor_user_id, actor_email, target_member_id, target_email, event_type, previous_role
  ) values (
    target_org, actor_user, actor_email_value, target_member, member_email, 'removed', current_role
  ) returning id, created_at into event_id, event_created;
  delete from organization_members where id = target_member and organization_id = target_org;

  return jsonb_build_object(
    'removed', true, 'id', target_member,
    'event', jsonb_build_object('id', event_id, 'actor_email', actor_email_value, 'target_email', member_email,
      'event_type', 'removed', 'previous_role', current_role, 'new_role', null, 'created_at', event_created)
  );
end;
$$;

revoke all on function add_organization_member(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function update_organization_member_role(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function delete_organization_member(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function add_organization_member(uuid, text, text, uuid) to service_role;
grant execute on function update_organization_member_role(uuid, uuid, text, uuid) to service_role;
grant execute on function delete_organization_member(uuid, uuid, uuid) to service_role;


-- Consolidated from: 2026080616_reminder_delivery_recipients.sql

-- Preserve reply-to and internal copy recipients as part of every audited reminder-template change.
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

  select id into target_policy_id from reminder_policies
  where organization_id = target_org and is_default for update;

  if target_policy_id is null then
    insert into reminder_policies (organization_id, name, is_default, days_from_due, is_active)
    values (target_org, 'Výchozí upomínky', true, new_days, new_active)
    returning id into target_policy_id;
  else
    update reminder_policies set days_from_due = new_days, is_active = new_active, updated_at = now()
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
      end from unnest(new_days) offset_day
    ) end,
    updated_at = now()
  where invoice.organization_id = target_org and invoice.status in ('pending', 'overdue')
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


-- Consolidated from: 2026080617_single_automation_run.sql

-- Recover abandoned worker records and prevent concurrent manual/cron runs for one organization.
alter table reminder_automation_runs
  add column if not exists trigger_source text not null default 'scheduled',
  add column if not exists triggered_by uuid references auth.users(id) on delete set null,
  add column if not exists triggered_by_email text;

alter table reminder_automation_runs
  drop constraint if exists reminder_automation_runs_trigger_source_check,
  add constraint reminder_automation_runs_trigger_source_check check (trigger_source in ('scheduled', 'manual')),
  drop constraint if exists reminder_automation_runs_trigger_email_check,
  add constraint reminder_automation_runs_trigger_email_check check (
    (trigger_source = 'scheduled' and triggered_by_email is null)
    or (trigger_source = 'manual' and triggered_by_email is not null and triggered_by_email = lower(triggered_by_email))
  );

update reminder_automation_runs
set status = 'failed',
    finished_at = now(),
    error_message = 'Předchozí běh nebyl dokončen v časovém limitu.'
where status = 'running'
  and started_at <= now() - interval '90 minutes';

create unique index if not exists reminder_automation_runs_one_running_per_org
  on reminder_automation_runs (organization_id)
  where status = 'running';


-- Consolidated from: 2026080618_partial_payments.sql

-- Multiple bank transfers may settle one invoice. The invoice keeps an atomically
-- maintained paid amount so every list and report can use the real outstanding balance.
alter table invoices add column if not exists paid_amount numeric(14,2) not null default 0;
update invoices set paid_amount = amount where status = 'paid';
alter table invoices drop constraint if exists invoices_paid_amount_check;
alter table invoices add constraint invoices_paid_amount_check
  check (paid_amount >= 0 and paid_amount <= amount);
alter table invoices drop constraint if exists invoices_payment_balance_state_check;
alter table invoices add constraint invoices_payment_balance_state_check check (
  (status = 'paid' and paid_amount = amount)
  or (status in ('pending', 'overdue') and paid_amount < amount)
  or (status = 'cancelled' and paid_amount = 0)
);

drop index if exists bank_payments_one_match_per_invoice;

alter table invoice_events drop constraint if exists invoice_events_event_type_check;
alter table invoice_events add constraint invoice_events_event_type_check check (event_type in (
  'created', 'updated', 'paid', 'reopened', 'cancelled', 'overdue',
  'reminders_paused', 'reminders_resumed', 'payment_changed'
));

create or replace function audit_invoice_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare fields text[]; status_event text;
begin
  if tg_op = 'INSERT' then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type)
    values (new.organization_id, new.id, new.created_by, 'created');
    return new;
  end if;
  if new.status is distinct from old.status then
    status_event := case when new.status = 'paid' then 'paid'
      when old.status = 'paid' and new.status in ('pending', 'overdue') then 'reopened'
      when new.status = 'cancelled' then 'cancelled'
      when new.status = 'overdue' then 'overdue' else 'updated' end;
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type, details)
    values (new.organization_id, new.id, case when status_event = 'overdue' then null else new.updated_by end,
      status_event, jsonb_build_object('from', old.status, 'to', new.status, 'paid_at', new.paid_at,
        'paid_amount', new.paid_amount, 'remaining', new.amount - new.paid_amount));
  elsif new.paid_at is distinct from old.paid_at and new.status = 'paid' then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type, details)
    values (new.organization_id, new.id, new.updated_by, 'paid', jsonb_build_object('paid_at', new.paid_at, 'corrected', true));
  end if;
  if new.reminders_paused is distinct from old.reminders_paused then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type)
    values (new.organization_id, new.id, coalesce(new.reminders_paused_by, new.updated_by),
      case when new.reminders_paused then 'reminders_paused' else 'reminders_resumed' end);
  end if;
  if new.paid_amount is distinct from old.paid_amount and new.status <> 'paid' and old.status <> 'paid' then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type, details)
    values (new.organization_id, new.id, new.updated_by, 'payment_changed', jsonb_build_object(
      'from', old.paid_amount, 'to', new.paid_amount, 'remaining', new.amount - new.paid_amount));
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

create or replace function assign_bank_payment(target_org uuid, target_payment uuid, target_invoice uuid, actor_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p bank_payments%rowtype; i invoices%rowtype; new_paid numeric; company_today date := (now() at time zone 'Europe/Prague')::date;
begin
  if not exists (select 1 from organization_members where organization_id=target_org and user_id=actor_user and role in ('accounting','admin')) then raise exception 'insufficient payment assignment permission'; end if;
  select * into p from bank_payments where id=target_payment and organization_id=target_org and match_status in ('unmatched','ambiguous') for update;
  if not found then raise exception 'payment is not available for assignment'; end if;
  select * into i from invoices where id=target_invoice and organization_id=target_org and status in ('pending','overdue') for update;
  if not found then raise exception 'invoice is not available for assignment'; end if;
  if p.currency <> i.currency or p.amount > i.amount-i.paid_amount then raise exception 'payment exceeds remaining amount or currency does not match invoice'; end if;
  new_paid := i.paid_amount+p.amount;
  update bank_payments set invoice_id=i.id, match_status='matched', matched_at=now(), unmatched_at=null, unmatched_by=null where id=p.id;
  update invoices set paid_amount=new_paid,
    status=case when new_paid=amount then 'paid' when due_date<company_today then 'overdue' else 'pending' end,
    paid_at=case when new_paid=amount then (p.booked_on+time '12:00') at time zone 'Europe/Prague' else null end,
    next_reminder_at=case when new_paid=amount then null else next_reminder_at end,
    updated_by=actor_user, updated_at=now() where id=i.id;
  return jsonb_build_object('payment_id',p.id,'invoice_id',i.id,'invoice_number',i.invoice_number,'status','matched',
    'settlement',case when new_paid=i.amount then 'full' else 'partial' end,'paid_amount',new_paid,
    'remaining',i.amount-new_paid,'invoice_status',case when new_paid=i.amount then 'paid' when i.due_date<company_today then 'overdue' else 'pending' end);
end; $$;
revoke all on function assign_bank_payment(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function assign_bank_payment(uuid,uuid,uuid,uuid) to service_role;

create or replace function unassign_bank_payment(target_org uuid, target_payment uuid, actor_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p bank_payments%rowtype; i invoices%rowtype; new_paid numeric; new_status text;
  policy_days integer[] := array[-3,0,7,14]; policy_active boolean := true;
  company_today date := (now() at time zone 'Europe/Prague')::date; next_time_value timestamptz;
begin
  if not exists (select 1 from organization_members where organization_id=target_org and user_id=actor_user and role in ('accounting','admin')) then raise exception 'insufficient payment unassignment permission'; end if;
  select * into p from bank_payments where id=target_payment and organization_id=target_org and match_status='matched' and invoice_id is not null for update;
  if not found then raise exception 'matched payment not found'; end if;
  select * into i from invoices where id=p.invoice_id and organization_id=target_org for update;
  if not found then raise exception 'invoice not found'; end if;
  new_paid := greatest(0,i.paid_amount-p.amount); new_status := case when i.due_date<company_today then 'overdue' else 'pending' end;
  select days_from_due,is_active into policy_days,policy_active from reminder_policies where organization_id=target_org
    and (id=i.reminder_policy_id or (i.reminder_policy_id is null and is_default)) order by (id=i.reminder_policy_id) desc limit 1;
  next_time_value := case when i.reminders_paused or not coalesce(policy_active,true) then null else (
    select case when count(*) filter(where i.due_date+d<=company_today)>0 then (company_today+time '06:00') at time zone 'Europe/Prague'
      else ((min(i.due_date+d))+time '06:00') at time zone 'Europe/Prague' end from unnest(coalesce(policy_days,array[-3,0,7,14])) d) end;
  update bank_payments set invoice_id=null,match_status='unmatched',matched_at=null,unmatched_at=now(),unmatched_by=actor_user where id=p.id;
  update invoices set status=new_status,paid_amount=new_paid,paid_at=null,next_reminder_at=next_time_value,updated_by=actor_user,updated_at=now() where id=i.id;
  if i.status='paid' then update reminder_log set status='failed',error_message='Bankovní platba byla uvolněna; krok čeká na nové vyhodnocení.',updated_at=now() where invoice_id=i.id and status='skipped' and sent_at is null; end if;
  return jsonb_build_object('payment_id',p.id,'invoice_id',i.id,'invoice_number',i.invoice_number,'status','unmatched','invoice_status',new_status,'paid_amount',new_paid,'remaining',i.amount-new_paid);
end; $$;
revoke all on function unassign_bank_payment(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function unassign_bank_payment(uuid,uuid,uuid) to service_role;

create or replace function reopen_paid_invoice(target_org uuid,target_invoice uuid,actor_user uuid,new_status text,next_time timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare i invoices%rowtype; reopened invoices%rowtype; detached integer:=0;
begin
  if not exists(select 1 from organization_members where organization_id=target_org and user_id=actor_user and role in('accounting','admin')) then raise exception 'insufficient_permission'; end if;
  if new_status not in('pending','overdue') then raise exception 'invalid_reopen_status'; end if;
  select * into i from invoices where id=target_invoice and organization_id=target_org for update;
  if not found then raise exception 'invoice_not_found'; end if; if i.status<>'paid' then raise exception 'invoice_not_paid'; end if;
  update bank_payments set invoice_id=null,match_status='unmatched',matched_at=null,unmatched_at=now(),unmatched_by=actor_user where organization_id=target_org and invoice_id=target_invoice and match_status='matched';
  get diagnostics detached=row_count;
  update invoices set status=new_status,paid_amount=0,paid_at=null,next_reminder_at=next_time,updated_by=actor_user,updated_at=now() where id=target_invoice and organization_id=target_org returning * into reopened;
  update reminder_log set status='failed',error_message='Faktura byla znovu otevřena; krok čeká na nové vyhodnocení.',updated_at=now() where invoice_id=target_invoice and status='skipped' and sent_at is null;
  update invoice_events set details=details||jsonb_build_object('paid_at',i.paid_at,'detached_payments',detached) where id=(select id from invoice_events where invoice_id=target_invoice and event_type='reopened' order by created_at desc limit 1);
  return jsonb_build_object('invoice',to_jsonb(reopened),'detached_payments',detached);
end; $$;
revoke all on function reopen_paid_invoice(uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function reopen_paid_invoice(uuid,uuid,uuid,text,timestamptz) to service_role;

create or replace function import_and_reconcile_bank_payments(target_org uuid,actor_user uuid,payment_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p jsonb; payment_id uuid; candidate_id uuid; candidate_number text; candidate_count integer; remaining numeric;
  imported integer:=0; matched integer:=0; partial integer:=0; unmatched integer:=0; ambiguous integer:=0; duplicates integer:=0; results jsonb:='[]'::jsonb;
begin
  if jsonb_typeof(payment_rows)<>'array' or jsonb_array_length(payment_rows)<1 or jsonb_array_length(payment_rows)>500 then raise exception 'invalid payment batch'; end if;
  if not exists(select 1 from organization_members where organization_id=target_org and user_id=actor_user and role in('accounting','admin')) then raise exception 'insufficient payment import permission'; end if;
  for p in select value from jsonb_array_elements(payment_rows) loop
    payment_id:=null; candidate_id:=null; candidate_number:=null; candidate_count:=0; remaining:=null;
    insert into bank_payments(organization_id,external_id,booked_on,amount,currency,variable_symbol,counterparty_name,counterparty_account,note,imported_by)
    values(target_org,trim(p->>'external_id'),(p->>'booked_on')::date,(p->>'amount')::numeric,upper(p->>'currency'),nullif(trim(p->>'variable_symbol'),''),nullif(trim(p->>'counterparty_name'),''),nullif(trim(p->>'counterparty_account'),''),nullif(trim(p->>'note'),''),actor_user)
    on conflict(organization_id,external_id) do nothing returning id into payment_id;
    if payment_id is null then duplicates:=duplicates+1; results:=results||jsonb_build_array(jsonb_build_object('external_id',p->>'external_id','status','duplicate')); continue; end if;
    imported:=imported+1;
    if nullif(trim(p->>'variable_symbol'),'') is not null then
      select count(*),(array_agg(id order by id))[1],(array_agg(invoice_number order by id))[1] into candidate_count,candidate_id,candidate_number
      from invoices where organization_id=target_org and status in('pending','overdue') and variable_symbol=trim(p->>'variable_symbol')
        and currency=upper(p->>'currency') and (p->>'amount')::numeric<=amount-paid_amount;
    end if;
    if candidate_count=1 then
      select amount-paid_amount into remaining from invoices where id=candidate_id and organization_id=target_org and status in('pending','overdue') for update;
      if remaining is null or (p->>'amount')::numeric>remaining then candidate_count:=0; end if;
    end if;
    if candidate_count=1 then
      update bank_payments set invoice_id=candidate_id,match_status='matched',matched_at=now() where id=payment_id;
      update invoices set paid_amount=paid_amount+(p->>'amount')::numeric,
        status=case when paid_amount+(p->>'amount')::numeric=amount then 'paid' when due_date<(now() at time zone 'Europe/Prague')::date then 'overdue' else 'pending' end,
        paid_at=case when paid_amount+(p->>'amount')::numeric=amount then ((p->>'booked_on')::date+time '12:00') at time zone 'Europe/Prague' else null end,
        next_reminder_at=case when paid_amount+(p->>'amount')::numeric=amount then null else next_reminder_at end,updated_by=actor_user,updated_at=now()
      where id=candidate_id and organization_id=target_org and status in('pending','overdue');
      matched:=matched+1; if (p->>'amount')::numeric<remaining then partial:=partial+1; end if;
      results:=results||jsonb_build_array(jsonb_build_object('external_id',p->>'external_id','status','matched','invoice_id',candidate_id,'invoice_number',candidate_number,'settlement',case when (p->>'amount')::numeric=remaining then 'full' else 'partial' end,'remaining',remaining-(p->>'amount')::numeric));
    elsif candidate_count>1 then update bank_payments set match_status='ambiguous' where id=payment_id; ambiguous:=ambiguous+1; results:=results||jsonb_build_array(jsonb_build_object('external_id',p->>'external_id','status','ambiguous'));
    else unmatched:=unmatched+1; results:=results||jsonb_build_array(jsonb_build_object('external_id',p->>'external_id','status','unmatched')); end if;
  end loop;
  return jsonb_build_object('imported',imported,'matched',matched,'partial_matched',partial,'unmatched',unmatched,'ambiguous',ambiguous,'duplicates',duplicates,'results',results);
end; $$;
revoke all on function import_and_reconcile_bank_payments(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function import_and_reconcile_bank_payments(uuid,uuid,jsonb) to service_role;

create or replace function list_invoices_page(target_org uuid,actor_user uuid,search_query text default null,status_filter text default null,currency_filter text default null,issue_from date default null,issue_to date default null,page_number integer default 1,page_size integer default 25)
returns jsonb language plpgsql security definer set search_path=public as $$ declare result jsonb; begin
  if not exists(select 1 from organization_members where organization_id=target_org and user_id=actor_user) then raise exception 'insufficient_permission'; end if;
  if page_number<1 or page_size<1 or page_size>500 then raise exception 'invalid_pagination'; end if;
  with filtered as materialized(select i.* from invoices i where i.organization_id=target_org and(status_filter is null or i.status=status_filter) and(currency_filter is null or i.currency=currency_filter) and(issue_from is null or i.issue_date>=issue_from) and(issue_to is null or i.issue_date<=issue_to) and(nullif(trim(search_query),'') is null or i.invoice_number ilike '%'||trim(search_query)||'%' or i.counterparty_name ilike '%'||trim(search_query)||'%' or i.counterparty_email ilike '%'||trim(search_query)||'%' or coalesce(i.variable_symbol,'') ilike '%'||trim(search_query)||'%')),
  paged as(select * from filtered order by due_date,id offset(page_number-1)*page_size limit page_size),totals as(select currency,sum(amount-paid_amount) amount from filtered where status in('pending','overdue') group by currency),currencies as(select distinct currency from invoices where organization_id=target_org)
  select jsonb_build_object('invoices',coalesce((select jsonb_agg(to_jsonb(p) order by p.due_date,p.id) from paged p),'[]'::jsonb),'total',(select count(*) from filtered),'open_totals',coalesce((select jsonb_object_agg(currency,amount) from totals),'{}'::jsonb),'currencies',coalesce((select jsonb_agg(currency order by currency) from currencies),'[]'::jsonb),'active_count',(select count(*) from invoices where organization_id=target_org and status in('pending','overdue'))) into result; return result;
end; $$;
revoke all on function list_invoices_page(uuid,uuid,text,text,text,date,date,integer,integer) from public,anon,authenticated;
grant execute on function list_invoices_page(uuid,uuid,text,text,text,date,date,integer,integer) to service_role;

create or replace function invoice_report_rows_page(target_org uuid,actor_user uuid,report_from date,report_to date,date_basis text,currency_filter text,status_filter text default null,customer_filter text default null,page_number integer default 1,page_size integer default 500)
returns jsonb language plpgsql security definer set search_path=public as $$ declare result jsonb; begin
  if not exists(select 1 from organization_members where organization_id=target_org and user_id=actor_user) then raise exception 'insufficient_permission'; end if;
  if report_from>report_to or page_number<1 or page_size<1 or page_size>500 then raise exception 'invalid_request'; end if;
  with filtered as materialized(select i.invoice_number,i.counterparty_name,i.amount,i.paid_amount,i.amount-i.paid_amount remaining_amount,i.currency,i.issue_date,i.due_date,i.paid_at,i.status,i.reminders_sent,i.id from invoices i where i.organization_id=target_org and i.currency=currency_filter and(status_filter is null or i.status=status_filter) and(customer_filter is null or i.counterparty_name=customer_filter) and((date_basis='issue_date' and i.issue_date between report_from and report_to)or(date_basis='due_date' and i.due_date between report_from and report_to)or(date_basis='paid_at' and(i.paid_at at time zone 'Europe/Prague')::date between report_from and report_to))),paged as(select * from filtered order by issue_date,id offset(page_number-1)*page_size limit page_size)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.issue_date,p.id) from paged p),'[]'::jsonb),'total',(select count(*) from filtered)) into result; return result;
end; $$;
revoke all on function invoice_report_rows_page(uuid,uuid,date,date,text,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function invoice_report_rows_page(uuid,uuid,date,date,text,text,text,text,integer,integer) to service_role;

create or replace function invoice_report_summary(target_org uuid,actor_user uuid,report_from date,report_to date,date_basis text,currency_filter text,status_filter text default null,customer_filter text default null,as_of_date date default current_date)
returns jsonb language plpgsql security definer set search_path=public as $$ declare result jsonb; begin
  if not exists(select 1 from organization_members where organization_id=target_org and user_id=actor_user) then raise exception 'insufficient_permission'; end if;
  if report_from>report_to then raise exception 'invalid_period'; end if;
  with filtered as materialized(select i.* from invoices i where i.organization_id=target_org and i.currency=currency_filter and(status_filter is null or i.status=status_filter) and(customer_filter is null or i.counterparty_name=customer_filter) and((date_basis='issue_date' and i.issue_date between report_from and report_to)or(date_basis='due_date' and i.due_date between report_from and report_to)or(date_basis='paid_at' and(i.paid_at at time zone 'Europe/Prague')::date between report_from and report_to))),
  aging as(select case when as_of_date-due_date<=0 then 0 when as_of_date-due_date<=7 then 1 when as_of_date-due_date<=14 then 2 when as_of_date-due_date<=30 then 3 else 4 end bucket,sum(amount-paid_amount) amount,count(*) count from filtered where status in('pending','overdue') group by 1),
  monthly as(select to_char(issue_date,'YYYY-MM') key,sum(amount) issued,sum(paid_amount) paid from filtered group by 1),
  debtors as(select counterparty_name name,sum(amount-paid_amount) open,coalesce(sum(amount-paid_amount)filter(where status='overdue'),0) overdue,count(*) count,sum(reminders_sent) reminders from filtered where status in('pending','overdue') group by counterparty_name)
  select jsonb_build_object(
    'invoice_count',(select count(*)from filtered),'total',coalesce((select sum(amount)from filtered),0),
    'paid',coalesce((select sum(paid_amount)from filtered where status<>'cancelled'),0),
    'overdue',coalesce((select sum(amount-paid_amount)from filtered where status='overdue'),0),
    'open',coalesce((select sum(amount-paid_amount)from filtered where status in('pending','overdue')),0),
    'paid_rate',coalesce((select round(100*coalesce(sum(paid_amount)filter(where status<>'cancelled'),0)/nullif(coalesce(sum(amount)filter(where status<>'cancelled'),0),0))from filtered),0)::integer,
    'counts',jsonb_build_object('pending',(select count(*)from filtered where status='pending'),'overdue',(select count(*)from filtered where status='overdue'),'paid',(select count(*)from filtered where status='paid'),'cancelled',(select count(*)from filtered where status='cancelled')),
    'aging',coalesce((select jsonb_agg(jsonb_build_object('label',case g.bucket when 0 then 'Před splatností' when 1 then '1–7 dní' when 2 then '8–14 dní' when 3 then '15–30 dní' else 'Více než 30 dní' end,'amount',coalesce(a.amount,0),'count',coalesce(a.count,0))order by g.bucket)from generate_series(0,4)g(bucket)left join aging a using(bucket)),'[]'::jsonb),
    'monthly',coalesce((select jsonb_agg(jsonb_build_object('key',key,'issued',issued,'paid',paid)order by key)from monthly),'[]'::jsonb),
    'debtors',coalesce((select jsonb_agg(jsonb_build_object('name',name,'open',open,'overdue',overdue,'count',count,'reminders',reminders)order by open desc,name)from debtors),'[]'::jsonb),
    'currencies',coalesce((select jsonb_agg(currency order by currency)from(select distinct currency from invoices where organization_id=target_org)c),'[]'::jsonb),
    'customers',coalesce((select jsonb_agg(counterparty_name order by counterparty_name)from(select distinct counterparty_name from invoices where organization_id=target_org)n),'[]'::jsonb)) into result; return result;
end; $$;
revoke all on function invoice_report_summary(uuid,uuid,date,date,text,text,text,text,date) from public,anon,authenticated;
grant execute on function invoice_report_summary(uuid,uuid,date,date,text,text,text,text,date) to service_role;

create or replace function dashboard_summary(target_org uuid,actor_user uuid) returns jsonb language plpgsql security definer set search_path=public as $$ declare result jsonb; begin
  if not exists(select 1 from organization_members where organization_id=target_org and user_id=actor_user) then raise exception 'insufficient_permission'; end if;
  with totals as(select currency,coalesce(sum(amount-paid_amount)filter(where status in('pending','overdue')),0) open_amount,coalesce(sum(amount-paid_amount)filter(where status='overdue'),0) overdue_amount,coalesce(sum(paid_amount)filter(where status<>'cancelled'),0) received from invoices where organization_id=target_org group by currency),recent as(select id,invoice_number,variable_symbol,counterparty_name,counterparty_email,amount,paid_amount,currency,due_date,status,reminders_sent,created_at from invoices where organization_id=target_org order by created_at desc,id desc limit 5),upcoming as(select id,invoice_number,counterparty_name,amount,paid_amount,currency,status,next_reminder_at from invoices where organization_id=target_org and status in('pending','overdue') and next_reminder_at is not null order by next_reminder_at,id limit 4)
  select jsonb_build_object('open_totals',coalesce((select jsonb_object_agg(currency,open_amount)from totals where open_amount>0),'{}'::jsonb),'overdue_totals',coalesce((select jsonb_object_agg(currency,overdue_amount)from totals where overdue_amount>0),'{}'::jsonb),'paid_totals',coalesce((select jsonb_object_agg(currency,received)from totals where received>0),'{}'::jsonb),'active_count',(select count(*)from invoices where organization_id=target_org and status in('pending','overdue')),'overdue_count',(select count(*)from invoices where organization_id=target_org and status='overdue'),'reminders_sent',coalesce((select sum(reminders_sent)from invoices where organization_id=target_org),0),'recent',coalesce((select jsonb_agg(to_jsonb(r)order by r.created_at desc,r.id desc)from recent r),'[]'::jsonb),'upcoming',coalesce((select jsonb_agg(to_jsonb(u)order by u.next_reminder_at,u.id)from upcoming u),'[]'::jsonb)) into result; return result;
end; $$;
revoke all on function dashboard_summary(uuid,uuid) from public,anon,authenticated;
grant execute on function dashboard_summary(uuid,uuid) to service_role;


-- Consolidated from: 2026080619_corporate_email_domain.sql

-- Produkční přístup je omezen výhradně na firemní adresy @hlavica.cz.
-- Před spuštěním migrace odstraňte případné staré členy s jinou doménou.
alter table organization_members
  drop constraint if exists organization_members_email_domain_check;

alter table organization_members
  add constraint organization_members_email_domain_check
  check (email ~ '^[^@[:space:]]+@gmail\.com$');


-- Consolidated from: 2026080620_safe_invoice_delete.sql

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


-- Consolidated from: 2026080621_prioritize_open_invoices.sql

-- Keep invoices that require work ahead of the closed archive on every page.
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
  if status_filter is not null and status_filter not in ('pending', 'overdue', 'paid', 'cancelled') then raise exception 'invalid_status'; end if;
  if currency_filter is not null and currency_filter !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;
  if issue_from is not null and issue_to is not null and issue_from > issue_to then raise exception 'invalid_period'; end if;

  with filtered as materialized (
    select i.* from invoices i
    where i.organization_id = target_org
      and (status_filter is null or i.status = status_filter)
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


-- Consolidated from: 2026080622_invoice_archive.sql

-- Extend the paginated list with a closed state used by the invoice archive.
create or replace function list_invoices_page(
  target_org uuid, actor_user uuid, search_query text default null,
  status_filter text default null, currency_filter text default null,
  issue_from date default null, issue_to date default null,
  page_number integer default 1, page_size integer default 25
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
