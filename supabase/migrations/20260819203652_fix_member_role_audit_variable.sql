-- CURRENT_ROLE is a PostgreSQL keyword. Using current_role as a PL/pgSQL
-- variable caused audit events to store the database role (for example
-- service_role) and violate the role check constraint.
create or replace function update_organization_member_role(
  target_org uuid, target_member uuid, new_role text, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  previous_role_value text;
  member_email text;
  member_user uuid;
  member_created timestamptz;
  actor_email_value text;
  event_id uuid;
  event_created timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  if new_role not in ('viewer', 'accounting', 'admin') then raise exception 'invalid_role'; end if;
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin';
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;
  select role, email, user_id, created_at into previous_role_value, member_email, member_user, member_created
  from organization_members where id = target_member and organization_id = target_org for update;
  if not found then raise exception 'member_not_found'; end if;
  if previous_role_value = 'admin' and new_role <> 'admin'
    and (select count(*) from organization_members where organization_id = target_org and role = 'admin') <= 1 then raise exception 'last_admin'; end if;

  update organization_members set role = new_role where id = target_member;
  insert into organization_member_events (
    organization_id, actor_user_id, actor_email, target_member_id, target_email, event_type, previous_role, new_role
  ) values (
    target_org, actor_user, actor_email_value, target_member, member_email, 'role_changed', previous_role_value, new_role
  ) returning id, created_at into event_id, event_created;

  return jsonb_build_object(
    'member', jsonb_build_object('id', target_member, 'email', member_email, 'role', new_role, 'user_id', member_user, 'created_at', member_created),
    'event', jsonb_build_object('id', event_id, 'actor_email', actor_email_value, 'target_email', member_email,
      'event_type', 'role_changed', 'previous_role', previous_role_value, 'new_role', new_role, 'created_at', event_created)
  );
end;
$$;

create or replace function delete_organization_member(
  target_org uuid, target_member uuid, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  previous_role_value text;
  member_user uuid;
  member_email text;
  actor_email_value text;
  event_id uuid;
  event_created timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin';
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;
  select role, user_id, email into previous_role_value, member_user, member_email
  from organization_members where id = target_member and organization_id = target_org for update;
  if not found then raise exception 'member_not_found'; end if;
  if member_user = actor_user then raise exception 'cannot_remove_self'; end if;
  if previous_role_value = 'admin'
    and (select count(*) from organization_members where organization_id = target_org and role = 'admin') <= 1 then raise exception 'last_admin'; end if;

  insert into organization_member_events (
    organization_id, actor_user_id, actor_email, target_member_id, target_email, event_type, previous_role
  ) values (
    target_org, actor_user, actor_email_value, target_member, member_email, 'removed', previous_role_value
  ) returning id, created_at into event_id, event_created;
  delete from organization_members where id = target_member and organization_id = target_org;

  return jsonb_build_object(
    'removed', true, 'id', target_member,
    'event', jsonb_build_object('id', event_id, 'actor_email', actor_email_value, 'target_email', member_email,
      'event_type', 'removed', 'previous_role', previous_role_value, 'new_role', null, 'created_at', event_created)
  );
end;
$$;

revoke all on function update_organization_member_role(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function delete_organization_member(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function update_organization_member_role(uuid, uuid, text, uuid) to service_role;
grant execute on function delete_organization_member(uuid, uuid, uuid) to service_role;
