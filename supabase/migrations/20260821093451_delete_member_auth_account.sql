-- Removing an application member now also removes the corresponding Auth user.
-- Business records must survive that deletion, so historical creator references
-- become nullable and are cleared by PostgreSQL when the Auth user is removed.
alter table invoices alter column created_by drop not null;
alter table invoices drop constraint invoices_created_by_fkey;
alter table invoices add constraint invoices_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table invoice_uploads alter column created_by drop not null;
alter table invoice_uploads drop constraint invoice_uploads_created_by_fkey;
alter table invoice_uploads add constraint invoice_uploads_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table bank_payments alter column imported_by drop not null;
alter table bank_payments drop constraint bank_payments_imported_by_fkey;
alter table bank_payments add constraint bank_payments_imported_by_fkey
  foreign key (imported_by) references auth.users(id) on delete set null;

create or replace function delete_organization_member(
  target_org uuid, target_member uuid, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  previous_role_value text;
  member_user uuid;
  auth_user uuid;
  member_email text;
  member_created timestamptz;
  actor_email_value text;
  event_id uuid;
  event_created timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin';
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;

  select role, user_id, email, created_at
  into previous_role_value, member_user, member_email, member_created
  from organization_members
  where id = target_member and organization_id = target_org
  for update;
  if not found then raise exception 'member_not_found'; end if;
  if member_user = actor_user then raise exception 'cannot_remove_self'; end if;
  if previous_role_value = 'admin'
    and (select count(*) from organization_members where organization_id = target_org and role = 'admin') <= 1
  then raise exception 'last_admin'; end if;

  -- A re-added invitation can have user_id = null while the old Auth account
  -- still exists. Resolve that account by the normalized, unique e-mail too.
  auth_user := member_user;
  if auth_user is null then
    select id into auth_user from auth.users where lower(email) = member_email limit 1;
  end if;

  insert into organization_member_events (
    organization_id, actor_user_id, actor_email, target_member_id,
    target_email, event_type, previous_role
  ) values (
    target_org, actor_user, actor_email_value, target_member,
    member_email, 'removed', previous_role_value
  ) returning id, created_at into event_id, event_created;

  delete from organization_members where id = target_member and organization_id = target_org;

  return jsonb_build_object(
    'removed', true,
    'id', target_member,
    'email', member_email,
    'previous_role', previous_role_value,
    'member_user_id', member_user,
    'auth_user_id', auth_user,
    'created_at', member_created,
    'event', jsonb_build_object(
      'id', event_id,
      'actor_email', actor_email_value,
      'target_email', member_email,
      'event_type', 'removed',
      'previous_role', previous_role_value,
      'new_role', null,
      'created_at', event_created
    )
  );
end;
$$;

-- Compensation used only when the external Auth Admin deletion fails after the
-- membership transaction. It restores the exact membership and records why the
-- access appeared again instead of leaving a half-deleted account.
create or replace function restore_organization_member_after_auth_delete_failure(
  target_org uuid,
  target_member uuid,
  target_user uuid,
  target_email text,
  target_role text,
  target_created timestamptz,
  actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  actor_email_value text;
  restored_member organization_members%rowtype;
  event_id uuid;
  event_created timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin';
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;
  if target_role not in ('viewer', 'accounting', 'admin') then raise exception 'invalid_role'; end if;

  insert into organization_members (id, organization_id, user_id, email, role, created_at)
  values (target_member, target_org, target_user, lower(trim(target_email)), target_role, target_created)
  returning * into restored_member;

  insert into organization_member_events (
    organization_id, actor_user_id, actor_email, target_member_id,
    target_email, event_type, new_role
  ) values (
    target_org, actor_user, actor_email_value, target_member,
    restored_member.email, 'added', restored_member.role
  ) returning id, created_at into event_id, event_created;

  return jsonb_build_object(
    'member', to_jsonb(restored_member),
    'event', jsonb_build_object(
      'id', event_id,
      'actor_email', actor_email_value,
      'target_email', restored_member.email,
      'event_type', 'added',
      'previous_role', null,
      'new_role', restored_member.role,
      'created_at', event_created
    )
  );
end;
$$;

revoke all on function delete_organization_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function restore_organization_member_after_auth_delete_failure(uuid, uuid, uuid, text, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function delete_organization_member(uuid, uuid, uuid) to service_role;
grant execute on function restore_organization_member_after_auth_delete_failure(uuid, uuid, uuid, text, text, timestamptz, uuid) to service_role;
