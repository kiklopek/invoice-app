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
