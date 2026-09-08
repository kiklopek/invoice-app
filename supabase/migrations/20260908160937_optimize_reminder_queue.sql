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
