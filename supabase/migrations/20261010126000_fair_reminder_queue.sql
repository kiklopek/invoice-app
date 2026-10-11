-- Férová fronta upomínek mezi firmami.
--
-- claim_reminder_jobs brala dávku (nejvýš 25 na běh) podle nejstaršího
-- scheduled_for napříč všemi firmami. Dokud byla ve Splatnu jedna firma,
-- nevadilo to; s více firmami jedna firma s velkou frontou zabrala celý běh
-- a ostatním upomínky neodcházely. Teď se dávka bere „po kolech“: první
-- upomínka každé firmy, pak druhá… (v rámci firmy dál od nejstarší).
-- Signatura, strop 25, zámky (for update skip locked) i lease beze změny.
-- Aktuální tělo: 20260808000000_baseline_schema.sql.

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
  with eligible as (
    select queue.id, queue.scheduled_for,
      row_number() over (partition by queue.organization_id order by queue.scheduled_for, queue.id) as turn
    from public.reminder_log as queue
    where queue.organization_id = any(target_organizations)
      and queue.status = 'queued'
      and queue.available_at <= target_now
      and queue.attempt_count < 3
      and (queue.lease_expires_at is null or queue.lease_expires_at <= target_now)
  ), picked as (
    select eligible.id from eligible
    order by eligible.turn, eligible.scheduled_for, eligible.id
    limit least(greatest(target_limit, 1), 25)
  ), candidates as (
    -- Zámek a podmínky znovu: mezi výběrem a zámkem mohl řádek převzít
    -- jiný worker.
    select queue.id
    from public.reminder_log as queue
    join picked on picked.id = queue.id
    where queue.status = 'queued'
      and queue.attempt_count < 3
      and (queue.lease_expires_at is null or queue.lease_expires_at <= target_now)
    for update of queue skip locked
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
