\set ON_ERROR_STOP on
-- Více firem: založení firmy zakladatelem, pozvánky s jednorázovým tokenem
-- a doména e-mailu hlídaná firmou, ne celou aplikací.
begin;
do $$
declare
  hlavica uuid := gen_random_uuid();
  hlavica_admin uuid := gen_random_uuid();
  founder uuid := gen_random_uuid();
  copycat uuid := gen_random_uuid();
  invited_user uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  pending_user uuid := gen_random_uuid();
  new_org uuid;
  member uuid;
  result jsonb;
  failed text;
  company jsonb := jsonb_build_object(
    'name', 'Nová firma s.r.o.', 'ico', '27082440', 'dic', 'CZ27082440',
    'registered_address', 'Dlouhá 1, Praha', 'email', 'faktury@novafirma.cz',
    'bank_account_czk', '19-2000145399/0800');
begin
  insert into auth.users(id, email) values
    (hlavica_admin, 'admin@hlavica.cz'), (founder, 'zakladatel@novafirma.cz'),
    (copycat, 'kopie@jinafirma.cz'), (invited_user, 'ucetni@novafirma.cz'),
    (stranger, 'cizi@example.cz'), (pending_user, 'cekajici@hlavica.cz');
  insert into public.organizations(id, name, ico, allowed_email_domain)
    values (hlavica, 'R. Hlavica', '26296039', 'hlavica.cz');
  insert into public.organization_members(organization_id, user_id, email, role)
    values (hlavica, hlavica_admin, 'admin@hlavica.cz', 'admin');

  -- Doména už není natvrdo v databázi: člen nové firmy smí mít jakýkoli e-mail.
  -- (pevný constraint @hlavica.cz by tenhle insert odmítl)

  -- 1) Zakladatel založí firmu naráz: firma, admin, výchozí upomínky (vypnuté).
  result := public.create_organization_for_user(founder, company);
  new_org := (result->>'organization_id')::uuid;
  if new_org is null then raise exception 'Organization not created: %', result; end if;
  if not exists (select 1 from public.organizations where id = new_org and created_by = founder
      and onboarding_completed_at is not null and ico = '27082440' and email = 'faktury@novafirma.cz') then
    raise exception 'Organization fields not stored';
  end if;
  if not exists (select 1 from public.organization_members where organization_id = new_org
      and user_id = founder and email = 'zakladatel@novafirma.cz' and role = 'admin') then
    raise exception 'Founder is not admin';
  end if;
  if not exists (select 1 from public.reminder_policies where organization_id = new_org
      and is_default and not is_active) then
    raise exception 'Default reminder policy must exist and stay inactive until the company enables it';
  end if;
  if not exists (select 1 from public.organization_member_events where organization_id = new_org
      and event_type = 'added' and target_email = 'zakladatel@novafirma.cz') then
    raise exception 'Founding not audited';
  end if;

  -- 2) Druhé založení stejným člověkem (dvojklik) se odmítne.
  begin
    perform public.create_organization_for_user(founder, company);
    raise exception 'expected already_member';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'already_member' then raise exception 'Second founding not refused: %', failed; end if;

  -- 3) Stejné IČO nemůže založit nikdo jiný.
  begin
    perform public.create_organization_for_user(copycat, company || '{"name":"Kopie"}');
    raise exception 'expected ico_taken';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'ico_taken' then raise exception 'Duplicate ICO not refused: %', failed; end if;

  -- 4) Neplatné IČO a chybějící název.
  begin
    perform public.create_organization_for_user(copycat, company || '{"ico":"12345678"}');
    raise exception 'expected invalid_ico';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'invalid_ico' then raise exception 'Invalid ICO not refused: %', failed; end if;
  begin
    perform public.create_organization_for_user(copycat, company || '{"name":"  ","ico":"25596641"}');
    raise exception 'expected invalid_name';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'invalid_name' then raise exception 'Empty name not refused: %', failed; end if;

  -- 5) Člověk s čekající pozvánkou nezakládá vlastní firmu, připojí se.
  insert into public.organization_members(organization_id, email, role)
    values (hlavica, 'cekajici@hlavica.cz', 'viewer');
  begin
    perform public.create_organization_for_user(pending_user, company || '{"ico":"25596641"}');
    raise exception 'expected pending_invitation';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'pending_invitation' then raise exception 'Invited person founded a company: %', failed; end if;

  -- 6) R. Hlavica zve jen @hlavica.cz.
  begin
    perform public.add_organization_member(hlavica, 'nekdo@gmail.com', 'viewer', hlavica_admin);
    raise exception 'expected email_domain_not_allowed';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'email_domain_not_allowed' then raise exception 'Foreign domain invited to Hlavica: %', failed; end if;

  -- 7) Jeden člověk = jedna firma: člena R. Hlavica nová firma nepozve.
  begin
    perform public.add_organization_member(new_org, 'admin@hlavica.cz', 'viewer', founder);
    raise exception 'expected member_of_other_organization';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'member_of_other_organization' then raise exception 'Cross-organization invite allowed: %', failed; end if;

  -- 8) Pozvánka s tokenem: vydat, přijmout jen správným e-mailem, jen jednou.
  result := public.add_organization_member(new_org, 'ucetni@novafirma.cz', 'accounting', founder);
  member := (result->'member'->>'id')::uuid;
  result := public.issue_organization_invitation(new_org, member, founder, repeat('a', 64), now() + interval '7 days');
  if (result->>'expires_at') is null then raise exception 'Invitation not issued: %', result; end if;

  begin
    perform public.accept_organization_invitation(repeat('a', 64), stranger);
    raise exception 'expected email_mismatch';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'email_mismatch' then raise exception 'Invitation accepted by wrong email: %', failed; end if;

  result := public.accept_organization_invitation(repeat('a', 64), invited_user);
  if (result->>'organization_id')::uuid <> new_org or result->>'role' <> 'accounting' then
    raise exception 'Invitation accept returned wrong data: %', result;
  end if;
  if not exists (select 1 from public.organization_members where id = member and user_id = invited_user
      and invite_token_hash is null) then
    raise exception 'Invitation not bound or token still usable';
  end if;
  begin
    perform public.accept_organization_invitation(repeat('a', 64), invited_user);
    raise exception 'expected invitation_not_found';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'invitation_not_found' then raise exception 'Invitation reused: %', failed; end if;

  -- 9) Opakované vydání starý odkaz zneplatní; prošlý odkaz neprojde.
  result := public.add_organization_member(new_org, 'cizi@example.cz', 'viewer', founder);
  member := (result->'member'->>'id')::uuid;
  perform public.issue_organization_invitation(new_org, member, founder, repeat('b', 64), now() + interval '7 days');
  perform public.issue_organization_invitation(new_org, member, founder, repeat('c', 64), now() - interval '1 minute');
  begin
    perform public.accept_organization_invitation(repeat('b', 64), stranger);
    raise exception 'expected invitation_not_found';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'invitation_not_found' then raise exception 'Rotated token still valid: %', failed; end if;
  begin
    perform public.accept_organization_invitation(repeat('c', 64), stranger);
    raise exception 'expected invitation_expired';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'invitation_expired' then raise exception 'Expired token accepted: %', failed; end if;

  -- 10) Pozvánku vydá jen admin dané firmy a jen pro nepřijatého člena.
  begin
    perform public.issue_organization_invitation(new_org, member, hlavica_admin, repeat('d', 64), now() + interval '7 days');
    raise exception 'expected insufficient_permission';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'insufficient_permission' then raise exception 'Foreign admin issued invitation: %', failed; end if;
  select id into member from public.organization_members where organization_id = new_org and user_id = invited_user;
  begin
    perform public.issue_organization_invitation(new_org, member, founder, repeat('e', 64), now() + interval '7 days');
    raise exception 'expected not_pending';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'not_pending' then raise exception 'Invitation issued for active member: %', failed; end if;

  -- 11) Klientské role nové funkce nevolají.
  if has_function_privilege('authenticated', 'public.create_organization_for_user(uuid, jsonb)', 'execute')
    or has_function_privilege('anon', 'public.accept_organization_invitation(text, uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.issue_organization_invitation(uuid, uuid, uuid, text, timestamptz)', 'execute') then
    raise exception 'Client role can execute onboarding RPC';
  end if;

  -- 12) Nové akce mají vlastní limit pokusů.
  if not public.consume_auth_rate_limit('invitation_accept_ip', repeat('f', 64), 5, 900)
    or not public.consume_auth_rate_limit('invitation_send_email', repeat('f', 64), 5, 900)
    or not public.consume_auth_rate_limit('company_lookup_email', repeat('f', 64), 5, 900) then
    raise exception 'New rate limit actions refused';
  end if;

  -- 13) Data firmy A zůstávají firmě A: nová firma nevidí členy R. Hlavica.
  if exists (select 1 from public.organization_members where organization_id = new_org and email like '%@hlavica.cz') then
    raise exception 'Hlavica member leaked into new organization';
  end if;
end $$;
rollback;
