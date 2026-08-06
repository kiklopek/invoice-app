-- Immutable access-management audit. Every membership mutation is performed and
-- recorded in one transaction under the organization advisory lock.
create table organization_member_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text not null check (actor_email = lower(actor_email)),
  target_member_id uuid not null,
  target_email text not null check (target_email = lower(target_email)),
  event_type text not null check (event_type in ('added', 'role_changed', 'removed')),
  previous_role text check (previous_role is null or previous_role in ('viewer', 'accounting', 'admin')),
  new_role text check (new_role is null or new_role in ('viewer', 'accounting', 'admin')),
  created_at timestamptz not null default now(),
  check (
    (event_type = 'added' and previous_role is null and new_role is not null)
    or (event_type = 'role_changed' and previous_role is not null and new_role is not null)
    or (event_type = 'removed' and previous_role is not null and new_role is null)
  )
);

create index organization_member_events_org_created
  on organization_member_events (organization_id, created_at desc, id desc);

alter table organization_member_events enable row level security;
revoke insert, update, delete on organization_member_events from anon, authenticated;
create policy "members can view organization member events" on organization_member_events for select
  using (is_org_member(organization_id));

create or replace function add_organization_member(
  target_org uuid, new_email text, new_role text, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  actor_email_value text;
  member_id uuid;
  member_created timestamptz;
  event_id uuid;
  event_created timestamptz;
  normalized_email text := lower(trim(new_email));
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  if new_role not in ('viewer', 'accounting', 'admin') then raise exception 'invalid_role'; end if;
  if length(normalized_email) < 3 or length(normalized_email) > 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid_email'; end if;
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin';
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;

  insert into organization_members (organization_id, email, role)
  values (target_org, normalized_email, new_role)
  returning id, created_at into member_id, member_created;

  insert into organization_member_events (
    organization_id, actor_user_id, actor_email, target_member_id, target_email, event_type, new_role
  ) values (
    target_org, actor_user, actor_email_value, member_id, normalized_email, 'added', new_role
  ) returning id, created_at into event_id, event_created;

  return jsonb_build_object(
    'member', jsonb_build_object('id', member_id, 'email', normalized_email, 'role', new_role, 'user_id', null, 'created_at', member_created),
    'event', jsonb_build_object('id', event_id, 'actor_email', actor_email_value, 'target_email', normalized_email,
      'event_type', 'added', 'previous_role', null, 'new_role', new_role, 'created_at', event_created)
  );
end;
$$;

create or replace function update_organization_member_role(
  target_org uuid, target_member uuid, new_role text, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  current_role text;
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
  select role, email, user_id, created_at into current_role, member_email, member_user, member_created
  from organization_members where id = target_member and organization_id = target_org for update;
  if not found then raise exception 'member_not_found'; end if;
  if current_role = 'admin' and new_role <> 'admin'
    and (select count(*) from organization_members where organization_id = target_org and role = 'admin') <= 1 then raise exception 'last_admin'; end if;

  update organization_members set role = new_role where id = target_member;
  insert into organization_member_events (
    organization_id, actor_user_id, actor_email, target_member_id, target_email, event_type, previous_role, new_role
  ) values (
    target_org, actor_user, actor_email_value, target_member, member_email, 'role_changed', current_role, new_role
  ) returning id, created_at into event_id, event_created;

  return jsonb_build_object(
    'member', jsonb_build_object('id', target_member, 'email', member_email, 'role', new_role, 'user_id', member_user, 'created_at', member_created),
    'event', jsonb_build_object('id', event_id, 'actor_email', actor_email_value, 'target_email', member_email,
      'event_type', 'role_changed', 'previous_role', current_role, 'new_role', new_role, 'created_at', event_created)
  );
end;
$$;

create or replace function delete_organization_member(
  target_org uuid, target_member uuid, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  current_role text;
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
  select role, user_id, email into current_role, member_user, member_email
  from organization_members where id = target_member and organization_id = target_org for update;
  if not found then raise exception 'member_not_found'; end if;
  if member_user = actor_user then raise exception 'cannot_remove_self'; end if;
  if current_role = 'admin'
    and (select count(*) from organization_members where organization_id = target_org and role = 'admin') <= 1 then raise exception 'last_admin'; end if;

  insert into organization_member_events (
    organization_id, actor_user_id, actor_email, target_member_id, target_email, event_type, previous_role
  ) values (
    target_org, actor_user, actor_email_value, target_member, member_email, 'removed', current_role
  ) returning id, created_at into event_id, event_created;
  delete from organization_members where id = target_member and organization_id = target_org;

  return jsonb_build_object(
    'removed', true, 'id', target_member,
    'event', jsonb_build_object('id', event_id, 'actor_email', actor_email_value, 'target_email', member_email,
      'event_type', 'removed', 'previous_role', current_role, 'new_role', null, 'created_at', event_created)
  );
end;
$$;

revoke all on function add_organization_member(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function update_organization_member_role(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function delete_organization_member(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function add_organization_member(uuid, text, text, uuid) to service_role;
grant execute on function update_organization_member_role(uuid, uuid, text, uuid) to service_role;
grant execute on function delete_organization_member(uuid, uuid, uuid) to service_role;
