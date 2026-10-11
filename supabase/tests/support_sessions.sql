\set ON_ERROR_STOP on
-- Support přístup provozovatele: dočasné členství s rolí admin, viditelné
-- firmě, s auditem; po vypršení ho RLS neuzná, nepočítá se jako „poslední
-- admin“ a jeho odebrání nesmaže účet provozovatele.
begin;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid $$;

do $$
declare
  org uuid := gen_random_uuid();
  other_org uuid := gen_random_uuid();
  owner uuid := gen_random_uuid();
  operator uuid := gen_random_uuid();
  result jsonb;
  support_member uuid;
  failed text;
begin
  insert into auth.users(id, email) values (owner, 'jednatel@novafirma.cz'), (operator, 'podpora@splatno.cz');
  insert into public.organizations(id, name, ico, allowed_email_domain) values
    (org, 'Nová firma', '27082440', 'novafirma.cz'), (other_org, 'Jiná firma', '25596641', null);
  insert into public.organization_members(organization_id, user_id, email, role) values (org, owner, 'jednatel@novafirma.cz', 'admin');

  -- 1) Start: dočasný admin i přes doménový zámek firmy, audit, seznam adminů k upozornění.
  result := public.start_support_session(org, operator, 'podpora@splatno.cz', 'Kontrola párování výpisu', 60);
  if not (result->'admin_emails') ? 'jednatel@novafirma.cz' or jsonb_array_length(result->'admin_emails') <> 1 then
    raise exception 'admins to notify: %', result;
  end if;
  select id into support_member from public.organization_members
    where organization_id = org and user_id = operator and role = 'admin' and support_expires_at > now() + interval '59 minutes';
  if support_member is null then raise exception 'support membership not created'; end if;
  if not exists (select 1 from public.support_sessions where organization_id = org and operator_user_id = operator
      and reason = 'Kontrola párování výpisu' and ended_at is null) then
    raise exception 'support session not audited';
  end if;
  perform set_config('test.uid', operator::text, true);
  if not private.has_org_role(org, array['admin']) then raise exception 'support must act as admin'; end if;

  -- 2) Support se nepočítá jako admin firmy: jediného skutečného admina nejde
  --    degradovat ani odebrat (firma by po vypršení zůstala bez admina).
  begin
    perform public.update_organization_member_role(org,
      (select id from public.organization_members where organization_id = org and user_id = owner), 'accounting', operator);
    raise exception 'expected last_admin';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'last_admin' then raise exception 'support counted as admin: %', failed; end if;

  -- 3) Support člena nejde odebrat ani přeřadit běžnou cestou (smazala by
  --    přihlašovací účet provozovatele); končí se end_support_session.
  failed := null;
  begin
    perform public.delete_organization_member(org, support_member, owner);
    raise exception 'expected support_member';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'support_member' then raise exception 'support member removable as ordinary member: %', failed; end if;

  -- 4) Druhá relace ukončí první (provozovatel je najednou jen v jedné firmě).
  insert into public.subscriptions(organization_id, status, plan, period, billing_exempt)
    select o.id, 'active', 'business', 'yearly', true from public.organizations o
    where not exists (select 1 from public.subscriptions s where s.organization_id = o.id);
  result := public.start_support_session(other_org, operator, 'podpora@splatno.cz', 'Dotaz k fakturám', 15);
  if exists (select 1 from public.organization_members where organization_id = org and user_id = operator) then
    raise exception 'previous support membership kept';
  end if;
  if not exists (select 1 from public.support_sessions where organization_id = org and ended_at is not null) then
    raise exception 'previous support session not ended';
  end if;

  -- 5) Prošlé členství RLS neuzná a úklid ho odstraní.
  update public.organization_members set support_expires_at = now() - interval '1 minute'
    where organization_id = other_org and user_id = operator;
  if private.is_org_member(other_org) then raise exception 'expired support still grants access'; end if;
  if public.cleanup_expired_support_sessions() <> 1 then raise exception 'cleanup did not end the expired session'; end if;
  if exists (select 1 from public.organization_members where user_id = operator) then raise exception 'expired membership left behind'; end if;

  -- 6) Provozovatel, který je běžným členem firmy, support spustit nemůže.
  failed := null;
  begin
    perform public.start_support_session(org, owner, 'jednatel@novafirma.cz', 'Pokus o support', 15);
    raise exception 'expected operator_is_member';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'operator_is_member' then raise exception 'member started support: %', failed; end if;

  -- 7) Bez důvodu nebo s jinou délkou to nejde; přihlášený uživatel nic z toho volat nesmí.
  failed := null;
  begin
    perform public.start_support_session(org, operator, 'podpora@splatno.cz', 'x', 15);
    raise exception 'expected invalid_reason';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'invalid_reason' then raise exception 'short reason accepted: %', failed; end if;
  if has_function_privilege('authenticated', 'public.start_support_session(uuid,uuid,text,text,integer)', 'EXECUTE') then
    raise exception 'authenticated may start support sessions';
  end if;
end $$;
rollback;
