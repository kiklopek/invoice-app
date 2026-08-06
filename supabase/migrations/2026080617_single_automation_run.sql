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
