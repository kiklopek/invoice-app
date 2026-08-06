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
