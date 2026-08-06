-- Atomická ochrana posledního administrátora i při souběžných požadavcích.
create or replace function update_organization_member_role(
  target_org uuid, target_member uuid, new_role text, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare current_role text; member_email text; member_user uuid; member_created timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  if new_role not in ('viewer', 'accounting', 'admin') then raise exception 'invalid_role'; end if;
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user and role = 'admin') then raise exception 'insufficient_permission'; end if;
  select role, email, user_id, created_at into current_role, member_email, member_user, member_created
  from organization_members where id = target_member and organization_id = target_org for update;
  if not found then raise exception 'member_not_found'; end if;
  if current_role = 'admin' and new_role <> 'admin'
    and (select count(*) from organization_members where organization_id = target_org and role = 'admin') <= 1 then raise exception 'last_admin'; end if;
  update organization_members set role = new_role where id = target_member;
  return jsonb_build_object('id', target_member, 'email', member_email, 'role', new_role, 'user_id', member_user, 'created_at', member_created);
end;
$$;

create or replace function delete_organization_member(
  target_org uuid, target_member uuid, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare current_role text; member_user uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user and role = 'admin') then raise exception 'insufficient_permission'; end if;
  select role, user_id into current_role, member_user from organization_members where id = target_member and organization_id = target_org for update;
  if not found then raise exception 'member_not_found'; end if;
  if member_user = actor_user then raise exception 'cannot_remove_self'; end if;
  if current_role = 'admin'
    and (select count(*) from organization_members where organization_id = target_org and role = 'admin') <= 1 then raise exception 'last_admin'; end if;
  delete from organization_members where id = target_member and organization_id = target_org;
  return jsonb_build_object('removed', true, 'id', target_member);
end;
$$;

revoke all on function update_organization_member_role(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function delete_organization_member(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function update_organization_member_role(uuid, uuid, text, uuid) to service_role;
grant execute on function delete_organization_member(uuid, uuid, uuid) to service_role;
