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
