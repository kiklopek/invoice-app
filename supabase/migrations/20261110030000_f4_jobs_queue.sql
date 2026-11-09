-- Fáze F4 přestavby databáze (expand): jeden vzor pro práci na pozadí.
--
-- Fronta je zatím prázdná a nikdo ji nevolá. Typy se na ni převádějí po
-- jednom (reminder.send, ocr.extract, invoice.email, statement.reconcile,
-- assistance.evaluate) a stará a nová fronta nikdy neběží pro stejný typ
-- současně. dedupe_key je unikátní napříč celou historií typu, takže stejná
-- peněžní nebo e-mailová akce se nezařadí dvakrát.

create table public.jobs (
  id bigint generated always as identity primary key,
  type text not null check (type in ('reminder.send', 'ocr.extract', 'invoice.email', 'statement.reconcile', 'assistance.evaluate')),
  organization_id uuid references public.organizations(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null check (length(dedupe_key) between 1 and 240),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 50),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (type, dedupe_key),
  check ((status = 'running') = (lease_token is not null)),
  check ((lease_token is null) = (lease_until is null))
);
create index jobs_ready on public.jobs (type, available_at) where status in ('queued', 'running');
create index jobs_organization on public.jobs (organization_id, created_at desc);
create index jobs_dead on public.jobs (type, updated_at desc) where status = 'dead';
alter table public.jobs enable row level security;
revoke all on public.jobs from public, anon, authenticated;
grant select on public.jobs to service_role;

create or replace function public.enqueue_job(job_type text, org uuid, job_payload jsonb, job_dedupe_key text,
  job_max_attempts integer default 5, run_at timestamptz default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  job_id bigint;
begin
  insert into public.jobs (type, organization_id, payload, dedupe_key, max_attempts, available_at)
  values (job_type, org, coalesce(job_payload, '{}'::jsonb), job_dedupe_key, coalesce(job_max_attempts, 5), coalesce(run_at, now()))
  on conflict (type, dedupe_key) do nothing
  returning id into job_id;
  if job_id is null then
    select id into job_id from public.jobs where type = job_type and dedupe_key = job_dedupe_key;
  end if;
  return job_id;
end $$;

-- Vyzvedne splatné úlohy; běžící úloha s propadlým zámkem se vezme znovu.
create or replace function public.claim_jobs(job_type text, max_jobs integer, lease interval)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  claimed jsonb;
begin
  with ready as (
    select id from public.jobs
    where type = job_type
      and ((status = 'queued' and available_at <= now()) or (status = 'running' and lease_until < now()))
    order by available_at, id
    limit greatest(1, least(coalesce(max_jobs, 1), 100))
    for update skip locked
  ), updated as (
    update public.jobs j
    set status = 'running', lease_token = gen_random_uuid(), lease_until = now() + lease, updated_at = now()
    from ready where j.id = ready.id
    returning j.id, j.type, j.organization_id, j.payload, j.attempts, j.max_attempts, j.lease_token, j.lease_until
  )
  select coalesce(jsonb_agg(to_jsonb(updated) order by id), '[]'::jsonb) into claimed from updated;
  return claimed;
end $$;

create or replace function public.complete_job(job_id bigint, job_lease uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.jobs
  set status = 'done', lease_token = null, lease_until = null, finished_at = now(), updated_at = now()
  where id = job_id and status = 'running' and lease_token = job_lease;
  if not found then raise exception 'job_lease_lost'; end if;
end $$;

-- Další pokus za 1, 4, 9, 16 … minut (nejvýš 6 hodin); po posledním pokusu dead.
create or replace function public.fail_job(job_id bigint, job_lease uuid, error_text text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  next_status text;
begin
  update public.jobs
  set attempts = attempts + 1,
      status = case when attempts + 1 >= max_attempts then 'dead' else 'queued' end,
      available_at = case when attempts + 1 >= max_attempts then available_at
                          else now() + least(interval '6 hours', make_interval(mins => (attempts + 1) * (attempts + 1))) end,
      lease_token = null, lease_until = null,
      last_error = left(coalesce(error_text, 'unknown error'), 2000),
      finished_at = case when attempts + 1 >= max_attempts then now() end,
      updated_at = now()
  where id = job_id and status = 'running' and lease_token = job_lease
  returning status into next_status;
  if next_status is null then raise exception 'job_lease_lost'; end if;
  return next_status;
end $$;

revoke all on function public.enqueue_job(text, uuid, jsonb, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_jobs(text, integer, interval) from public, anon, authenticated;
revoke all on function public.complete_job(bigint, uuid) from public, anon, authenticated;
revoke all on function public.fail_job(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_job(text, uuid, jsonb, text, integer, timestamptz) to service_role;
grant execute on function public.claim_jobs(text, integer, interval) to service_role;
grant execute on function public.complete_job(bigint, uuid) to service_role;
grant execute on function public.fail_job(bigint, uuid, text) to service_role;

-- Hotové úlohy po 30 dnech pryč, mrtvé zůstávají k prošetření 180 dní.
create or replace function private.apply_retention() returns jsonb language plpgsql security definer set search_path = '' as $$
declare mfa integer; webhooks integer; stripe integer; drafts integer; done_jobs integer;
begin
  delete from public.email_mfa_challenges where expires_at < now() - interval '24 hours'; get diagnostics mfa = row_count;
  delete from public.provider_webhook_events where received_at < now() - interval '90 days'; get diagnostics webhooks = row_count;
  delete from public.stripe_events where received_at < now() - interval '90 days'; get diagnostics stripe = row_count;
  delete from public.onboarding_drafts where updated_at < now() - interval '90 days'; get diagnostics drafts = row_count;
  delete from public.jobs where (status = 'done' and finished_at < now() - interval '30 days')
    or (status = 'dead' and finished_at < now() - interval '180 days'); get diagnostics done_jobs = row_count;
  return jsonb_build_object('email_mfa_challenges', mfa, 'provider_webhook_events', webhooks, 'stripe_events', stripe,
    'onboarding_drafts', drafts, 'jobs', done_jobs, 'ran_at', now());
end $$;
