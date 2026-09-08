alter table public.reminder_policies
  add column archived_at timestamptz;

alter table public.reminder_policies
  add constraint reminder_policies_name_length
  check (length(trim(name)) between 1 and 100);

alter table public.invoices
  add column reminder_days_snapshot integer[],
  add column reminder_plan_effective_from date;

create or replace function public.valid_reminder_days(days integer[])
returns boolean language sql immutable parallel safe set search_path = pg_catalog as $$
  select days is not null and cardinality(days) between 1 and 10
    and not exists (select 1 from unnest(days) as item(day_value) where day_value < -90 or day_value > 365)
    and (select count(distinct day_value) from unnest(days) as item(day_value)) = cardinality(days)
$$;

revoke all on function public.valid_reminder_days(integer[]) from public, anon;
grant execute on function public.valid_reminder_days(integer[]) to authenticated, service_role;

insert into public.reminder_policies (organization_id, name, is_default, is_active, days_from_due)
select organization.id, 'Standardní', true, true, array[-3, 0, 7, 14]
from public.organizations organization
where not exists (
  select 1 from public.reminder_policies policy where policy.organization_id = organization.id
);

update public.invoices invoice
set reminder_days_snapshot = coalesce(policy.days_from_due, array[-3, 0, 7, 14])
from public.reminder_policies policy
where policy.id = invoice.reminder_policy_id;

update public.invoices invoice
set reminder_policy_id = policy.id,
    reminder_days_snapshot = policy.days_from_due
from public.reminder_policies policy
where invoice.reminder_policy_id is null
  and policy.organization_id = invoice.organization_id
  and policy.is_default;

update public.invoices
set reminder_days_snapshot = array[-3, 0, 7, 14]
where reminder_days_snapshot is null;

alter table public.invoices
  alter column reminder_days_snapshot set default array[-3, 0, 7, 14],
  alter column reminder_days_snapshot set not null,
  add constraint invoices_reminder_days_snapshot_valid check (public.valid_reminder_days(reminder_days_snapshot));

alter table public.reminder_policies
  add constraint reminder_policies_days_valid check (public.valid_reminder_days(days_from_due));

create index reminder_policies_active_org_idx
  on public.reminder_policies (organization_id, is_default, name)
  where archived_at is null;

create unique index reminder_policies_active_name_unique
  on public.reminder_policies (organization_id, lower(trim(name)))
  where archived_at is null;

create or replace function public.set_default_reminder_policy(target_org uuid, target_policy uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.reminder_policies
    where organization_id = target_org and id = target_policy and archived_at is null
  ) then
    raise exception 'policy_not_found';
  end if;
  update public.reminder_policies set is_default = false, updated_at = now()
  where organization_id = target_org and is_default;
  update public.reminder_policies set is_default = true, updated_at = now()
  where organization_id = target_org and id = target_policy and archived_at is null;
end;
$$;

revoke all on function public.set_default_reminder_policy(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_default_reminder_policy(uuid, uuid) to service_role;

create or replace function public.refresh_reminder_next_times(target_org uuid, automation_active boolean)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  company_today date := (now() at time zone 'Europe/Prague')::date;
begin
  update public.invoices invoice set next_reminder_at = case
    when not automation_active or invoice.reminders_paused then null
    else (
      select case
        when count(*) filter (where invoice.due_date + offset_day <= company_today) > 0
          then (company_today + time '06:00') at time zone 'Europe/Prague'
        else ((min(invoice.due_date + offset_day)) + time '06:00') at time zone 'Europe/Prague'
      end
      from unnest(invoice.reminder_days_snapshot) offset_day
      where invoice.reminder_plan_effective_from is null
        or invoice.due_date + offset_day >= invoice.reminder_plan_effective_from
    )
  end
  where invoice.organization_id = target_org and invoice.status in ('pending', 'overdue');
end;
$$;

revoke all on function public.refresh_reminder_next_times(uuid, boolean) from public, anon, authenticated;
grant execute on function public.refresh_reminder_next_times(uuid, boolean) to service_role;
