-- Cover every foreign-key access path reported by the Supabase database advisor.
-- Composite indexes intentionally cover organization_id constraints as their
-- left-most column, so fewer indexes are needed than reported constraints.
create index if not exists bank_payments_imported_by_idx on public.bank_payments (imported_by);
create index if not exists bank_payments_org_invoice_idx on public.bank_payments (organization_id, invoice_id);
create index if not exists bank_payments_unmatched_by_idx on public.bank_payments (unmatched_by);
create index if not exists invoice_events_actor_user_id_idx on public.invoice_events (actor_user_id);
create index if not exists invoice_events_org_invoice_idx on public.invoice_events (organization_id, invoice_id);
create index if not exists invoice_uploads_created_by_idx on public.invoice_uploads (created_by);
create index if not exists invoice_uploads_invoice_id_idx on public.invoice_uploads (invoice_id);
create index if not exists invoice_uploads_org_invoice_idx on public.invoice_uploads (organization_id, invoice_id);
create index if not exists invoices_created_by_idx on public.invoices (created_by);
create index if not exists invoices_org_policy_idx on public.invoices (organization_id, reminder_policy_id);
create index if not exists invoices_reminder_policy_id_idx on public.invoices (reminder_policy_id);
create index if not exists invoices_reminders_paused_by_idx on public.invoices (reminders_paused_by);
create index if not exists invoices_updated_by_idx on public.invoices (updated_by);
create index if not exists organization_member_events_actor_idx on public.organization_member_events (actor_user_id);
create index if not exists organization_members_user_id_idx on public.organization_members (user_id);
create index if not exists reminder_automation_runs_triggered_by_idx on public.reminder_automation_runs (triggered_by);
create index if not exists reminder_log_org_invoice_idx on public.reminder_log (organization_id, invoice_id);
create index if not exists reminder_settings_events_actor_idx on public.reminder_settings_events (actor_user_id);

-- These tables are internal implementation details. RLS without policies is
-- intentional: browser roles must never read or write MFA challenges or raw
-- provider webhook receipts.
revoke all on table public.email_mfa_challenges from public, anon, authenticated;
revoke all on table public.provider_webhook_events from public, anon, authenticated;

comment on table public.email_mfa_challenges is
  'Internal email MFA challenges. Deliberately inaccessible to anon/authenticated roles.';
comment on table public.provider_webhook_events is
  'Internal idempotency log for signed provider webhooks. Deliberately inaccessible to browser roles.';

-- Persistent, privacy-preserving rate-limit audit. The application stores only
-- keyed hashes of an e-mail/IP subject, never the original identifier.
create table if not exists public.auth_request_events (
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

alter table public.auth_request_events enable row level security;
revoke all on table public.auth_request_events from public, anon, authenticated;
grant select, insert, delete on table public.auth_request_events to service_role;
grant usage, select on sequence public.auth_request_events_id_seq to service_role;

create index if not exists auth_request_events_window_idx
  on public.auth_request_events (action, subject_hash, requested_at desc);
create index if not exists auth_request_events_retention_idx
  on public.auth_request_events (requested_at);

create or replace function public.consume_auth_rate_limit(
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

revoke all on function public.consume_auth_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_auth_rate_limit(text, text, integer, integer) to service_role;
