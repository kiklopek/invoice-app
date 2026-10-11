-- Support přístup provozovatele Splatna.
--
-- Provozovatel (účet v SPLATNO_OPERATOR_EMAILS, vždy s 2FA) vstoupí do firmy
-- zákazníka jako administrátor: bez souhlasu, ale viditelně -- s důvodem,
-- na 15/60/240 minut, s e-mailem administrátorům a záznamem v Nastavení → Tým.
--
-- Princip: dočasný řádek v organization_members (support_expires_at,
-- support_reason). Všechny RLS i RPC kontroly ho tak uznají bez přepisování.
-- * private.is_org_member / has_org_role prošlý řádek neuznají
--   (těla z 20261010120000_tenant_isolation_guards.sql + podmínka vypršení);
-- * support se nepočítá jako „poslední admin“ a nejde ho přeřadit ani
--   odebrat jako člena (delete by smazal účet provozovatele) -- těla
--   update_organization_member_role / delete_organization_member z baseline;
-- * start/end/cleanup jen pro service_role (API ověří provozovatele a 2FA);
-- * support_sessions: trvalý audit, členové firmy ho vidí.

alter table public.organization_members
  add column if not exists support_expires_at timestamptz,
  add column if not exists support_reason text;
alter table public.organization_members
  add constraint organization_members_support_shape check (
    (support_expires_at is null) = (support_reason is null)
    and (support_expires_at is null or (user_id is not null and role = 'admin'))
  );

create table if not exists public.support_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operator_user_id uuid references auth.users(id) on delete set null,
  operator_email text not null check (operator_email = lower(operator_email)),
  reason text not null check (length(btrim(reason)) between 5 and 300),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  ended_by uuid references auth.users(id) on delete set null,
  check (expires_at > started_at and expires_at <= started_at + interval '4 hours')
);
create index if not exists support_sessions_org on public.support_sessions (organization_id, started_at desc);
create unique index if not exists support_sessions_one_active on public.support_sessions (operator_user_id) where ended_at is null;

alter table public.support_sessions enable row level security;
revoke all on public.support_sessions from anon, authenticated;
grant select on public.support_sessions to authenticated;
grant select, insert, update, delete on public.support_sessions to service_role;
drop policy if exists "members can view support sessions" on public.support_sessions;
create policy "members can view support sessions" on public.support_sessions
  for select to authenticated using (private.is_org_member(organization_id));

create or replace function private.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
      and (m.support_expires_at is null or m.support_expires_at > now())
  );
$$;

create or replace function private.has_org_role(target_org uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = target_org
      and m.role = any(allowed_roles)
      and m.user_id = (select auth.uid())
      and (m.support_expires_at is null or m.support_expires_at > now())
  );
$$;

create or replace function update_organization_member_role(
  target_org uuid, target_member uuid, new_role text, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare previous_role_value text; member_email text; member_user uuid; member_created timestamptz;
  actor_email_value text; event_id uuid; event_created timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  if new_role not in ('viewer', 'accounting', 'admin') then raise exception 'invalid_role'; end if;
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin'
    and (support_expires_at is null or support_expires_at > now());
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;
  select role, email, user_id, created_at into previous_role_value, member_email, member_user, member_created
  from organization_members where id = target_member and organization_id = target_org for update;
  if not found then raise exception 'member_not_found'; end if;
  -- Support provozovatele se nepřeřazuje ani neodebírá jako člen (odebrání by
  -- smazalo jeho přihlašovací účet); končí přes end_support_session.
  if exists (select 1 from organization_members where id = target_member and support_expires_at is not null) then
    raise exception 'support_member';
  end if;
  if previous_role_value = 'admin' and new_role <> 'admin'
    and (select count(*) from organization_members where organization_id = target_org and role = 'admin' and support_expires_at is null) <= 1 then raise exception 'last_admin'; end if;
  update organization_members set role = new_role where id = target_member;
  insert into organization_member_events (organization_id, actor_user_id, actor_email, target_member_id, target_email, event_type, previous_role, new_role)
  values (target_org, actor_user, actor_email_value, target_member, member_email, 'role_changed', previous_role_value, new_role)
  returning id, created_at into event_id, event_created;
  return jsonb_build_object(
    'member', jsonb_build_object('id', target_member, 'email', member_email, 'role', new_role, 'user_id', member_user, 'created_at', member_created),
    'event', jsonb_build_object('id', event_id, 'actor_email', actor_email_value, 'target_email', member_email,
      'event_type', 'role_changed', 'previous_role', previous_role_value, 'new_role', new_role, 'created_at', event_created));
end;
$$;

create or replace function delete_organization_member(
  target_org uuid, target_member uuid, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare previous_role_value text; member_user uuid; member_email text;
  auth_user uuid; member_created timestamptz;
  actor_email_value text; event_id uuid; event_created timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin'
    and (support_expires_at is null or support_expires_at > now());
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;
  select role, user_id, email, created_at into previous_role_value, member_user, member_email, member_created
  from organization_members where id = target_member and organization_id = target_org for update;
  if not found then raise exception 'member_not_found'; end if;
  -- Support provozovatele se nepřeřazuje ani neodebírá jako člen (odebrání by
  -- smazalo jeho přihlašovací účet); končí přes end_support_session.
  if exists (select 1 from organization_members where id = target_member and support_expires_at is not null) then
    raise exception 'support_member';
  end if;
  if member_user = actor_user then raise exception 'cannot_remove_self'; end if;
  if previous_role_value = 'admin'
    and (select count(*) from organization_members where organization_id = target_org and role = 'admin' and support_expires_at is null) <= 1 then raise exception 'last_admin'; end if;
  auth_user := member_user;
  if auth_user is null then
    select id into auth_user from auth.users where lower(email) = member_email limit 1;
  end if;
  insert into organization_member_events (organization_id, actor_user_id, actor_email, target_member_id, target_email, event_type, previous_role)
  values (target_org, actor_user, actor_email_value, target_member, member_email, 'removed', previous_role_value)
  returning id, created_at into event_id, event_created;
  delete from organization_members where id = target_member and organization_id = target_org;
  return jsonb_build_object('removed', true, 'id', target_member, 'email', member_email,
    'previous_role', previous_role_value, 'member_user_id', member_user,
    'auth_user_id', auth_user, 'created_at', member_created,
    'event', jsonb_build_object('id', event_id, 'actor_email', actor_email_value, 'target_email', member_email,
      'event_type', 'removed', 'previous_role', previous_role_value, 'new_role', null, 'created_at', event_created));
end;
$$;

-- Ukončí aktivní support provozovatele (a smaže jeho dočasné členství).
create or replace function public.end_support_session(operator_user uuid, ended_by_user uuid default null)
returns integer language plpgsql security definer set search_path = public
as $$
declare ended integer;
begin
  delete from organization_members where user_id = operator_user and support_expires_at is not null;
  update support_sessions set ended_at = now(), ended_by = ended_by_user
    where operator_user_id = operator_user and ended_at is null;
  get diagnostics ended = row_count;
  return ended;
end;
$$;

create or replace function public.start_support_session(
  target_org uuid, operator_user uuid, operator_email text, reason text, minutes integer
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare expires timestamptz := now() + make_interval(mins => minutes);
  session_id uuid; admins jsonb; normalized_email text := lower(btrim(operator_email));
begin
  if minutes not in (15, 60, 240) then raise exception 'invalid_duration'; end if;
  if reason is null or length(btrim(reason)) < 5 or length(btrim(reason)) > 300 then raise exception 'invalid_reason'; end if;
  if not exists (select 1 from organizations where id = target_org) then raise exception 'organization_not_found'; end if;
  -- Provozovatel nesmí být běžným členem žádné firmy (jeden účet = nejvýš
  -- jedna firma; support je vždy oddělený účet).
  if exists (select 1 from organization_members where user_id = operator_user and support_expires_at is null) then
    raise exception 'operator_is_member';
  end if;
  perform public.end_support_session(operator_user, operator_user);
  -- Mimo add_organization_member: doménový zámek firmy se na support nevztahuje.
  insert into organization_members (organization_id, user_id, email, role, support_expires_at, support_reason)
    values (target_org, operator_user, normalized_email, 'admin', expires, btrim(reason));
  insert into support_sessions (organization_id, operator_user_id, operator_email, reason, expires_at)
    values (target_org, operator_user, normalized_email, btrim(reason), expires)
    returning id into session_id;
  select coalesce(jsonb_agg(email order by email), '[]'::jsonb) into admins
    from organization_members
    where organization_id = target_org and role = 'admin' and support_expires_at is null and user_id is not null;
  return jsonb_build_object('session_id', session_id, 'expires_at', expires, 'admin_emails', admins);
end;
$$;

-- Úklid prošlých relací (cron). Vrací počet ukončených.
create or replace function public.cleanup_expired_support_sessions()
returns integer language plpgsql security definer set search_path = public
as $$
declare ended integer;
begin
  -- Relace končí s dočasným členstvím (nebo když jí vypršel čas).
  with expired as (
    delete from organization_members
    where support_expires_at is not null and support_expires_at <= now()
    returning organization_id, user_id
  )
  update support_sessions s set ended_at = now()
    where s.ended_at is null
      and (s.expires_at <= now()
        or exists (select 1 from expired e where e.organization_id = s.organization_id and e.user_id = s.operator_user_id));
  get diagnostics ended = row_count;
  return ended;
end;
$$;

revoke all on function public.start_support_session(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.end_support_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cleanup_expired_support_sessions() from public, anon, authenticated;
grant execute on function public.start_support_session(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.end_support_session(uuid, uuid) to service_role;
grant execute on function public.cleanup_expired_support_sessions() to service_role;
