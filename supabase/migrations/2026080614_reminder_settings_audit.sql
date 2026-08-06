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
