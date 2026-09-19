-- save_default_reminder_settings_versioned's `expected_event uuid` parameter
-- was always meant to accept NULL (the "no prior revision yet" case -- see
-- `if latest_event is distinct from expected_event`), and the function body
-- already handles that correctly. But without an explicit `default null` on
-- the parameter, Supabase's generated TypeScript types infer it as a
-- required, non-null `string`, which no longer matches the application code
-- (src/app/api/settings/reminders/route.ts) that legitimately passes null
-- for a brand-new organization with no reminder_settings_events row yet.
-- This is a metadata-only change (adding a default does not alter behavior,
-- since NULL was already a valid argument value) so it's safe to apply as a
-- plain create-or-replace.
create or replace function public.save_default_reminder_settings_versioned(
  target_org uuid, new_days integer[], template_data jsonb, new_active boolean, actor_user uuid, expected_event uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare latest_event uuid; change_result jsonb;
begin
  if not exists(select 1 from public.organization_members where organization_id=target_org and user_id=actor_user and role in('accounting','admin')) then raise exception 'insufficient_permission'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  select id into latest_event from public.reminder_settings_events where organization_id=target_org order by created_at desc,id desc limit 1;
  if latest_event is distinct from expected_event then raise exception 'revision_conflict'; end if;
  change_result:=public.save_default_reminder_settings(target_org,new_days,template_data,new_active,actor_user);
  update public.reminder_policies set is_active=new_active,updated_at=now() where organization_id=target_org;
  perform public.refresh_reminder_next_times(target_org,new_active);
  return change_result;
end $$;
