-- Preserve reply-to and internal copy recipients as part of every audited reminder-template change.
create or replace function save_default_reminder_settings(
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
  stage_name text;
  stage_template jsonb;
  reply_to_value text;
  cc_values text[];
  normalized_templates jsonb := '{}'::jsonb;
begin
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role in ('accounting', 'admin');
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;

  if new_days is null or cardinality(new_days) < 1 or cardinality(new_days) > 10
    or exists (select 1 from unnest(new_days) as offsets(day_value) where day_value < -90 or day_value > 365)
    or (select count(distinct day_value) from unnest(new_days) as offsets(day_value)) <> cardinality(new_days) then
    raise exception 'invalid_days';
  end if;

  if template_data is null or jsonb_typeof(template_data) <> 'object' then
    raise exception 'invalid_templates';
  end if;
  foreach stage_name in array array['before_due', 'on_due', 'overdue', 'escalation'] loop
    stage_template := template_data -> stage_name;
    if stage_template is null or jsonb_typeof(stage_template) <> 'object'
      or coalesce(length(trim(stage_template ->> 'subject')), 0) not between 1 and 300
      or coalesce(length(trim(stage_template ->> 'body')), 0) not between 1 and 20000 then
      raise exception 'invalid_templates';
    end if;

    reply_to_value := nullif(lower(trim(coalesce(stage_template ->> 'reply_to', ''))), '');
    if reply_to_value is not null and (
      length(reply_to_value) > 254
      or reply_to_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ) then raise exception 'invalid_reply_to';
    end if;

    if stage_template ? 'cc' and stage_template -> 'cc' <> 'null'::jsonb
      and jsonb_typeof(stage_template -> 'cc') <> 'array' then
      raise exception 'invalid_cc';
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(nullif(stage_template -> 'cc', 'null'::jsonb), '[]'::jsonb)) as cc_item(value)
      where jsonb_typeof(cc_item.value) <> 'string'
    ) then raise exception 'invalid_cc';
    end if;
    select coalesce(array_agg(distinct lower(trim(value))) filter (where trim(value) <> ''), '{}'::text[])
      into cc_values
      from jsonb_array_elements_text(coalesce(nullif(stage_template -> 'cc', 'null'::jsonb), '[]'::jsonb)) item(value);
    if cardinality(cc_values) > 5 or exists (
      select 1 from unnest(cc_values) as copies(email_value)
      where length(email_value) > 254 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ) then raise exception 'invalid_cc';
    end if;

    normalized_templates := normalized_templates || jsonb_build_object(stage_name, jsonb_build_object(
      'subject', trim(stage_template ->> 'subject'),
      'body', trim(stage_template ->> 'body'),
      'reply_to', reply_to_value,
      'cc', to_jsonb(cc_values)
    ));
  end loop;

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

  insert into email_templates (organization_id, stage, subject, body, reply_to, cc, updated_at)
  select target_org, item.key, item.value ->> 'subject', item.value ->> 'body',
    nullif(item.value ->> 'reply_to', ''),
    array(select jsonb_array_elements_text(item.value -> 'cc')),
    now()
  from jsonb_each(normalized_templates) item
  on conflict (organization_id, stage) do update set
    subject = excluded.subject,
    body = excluded.body,
    reply_to = excluded.reply_to,
    cc = excluded.cc,
    updated_at = excluded.updated_at;

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
    target_org, actor_user, actor_email_value, new_active, new_days, normalized_templates
  ) returning id, created_at into event_id, event_created_at;

  return jsonb_build_object('id', event_id, 'changed_at', event_created_at, 'changed_by', actor_email_value);
end;
$$;

revoke all on function save_default_reminder_settings(uuid, integer[], jsonb, boolean, uuid) from public, anon, authenticated;
grant execute on function save_default_reminder_settings(uuid, integer[], jsonb, boolean, uuid) to service_role;
