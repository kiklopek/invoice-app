\set ON_ERROR_STOP on
-- Oddělení firem: RLS uzná člena jen podle převzatého členství (user_id),
-- ne podle e-mailu v JWT, a jedno IČO patří nejvýš jedné firmě.
begin;
-- Testovací náhrada auth.uid()/auth.jwt(): čte přihlášeného z nastavení relace.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object('email', nullif(current_setting('test.email', true), '')) $$;

do $$
declare
  org_a uuid := gen_random_uuid();
  org_b uuid := gen_random_uuid();
  member_a uuid := gen_random_uuid();
  impostor uuid := gen_random_uuid();
  failed text;
begin
  insert into auth.users(id, email) values (member_a, 'ucetni@firma-a.cz'), (impostor, 'pozvany@firma-a.cz');
  insert into public.organizations(id, name, ico) values (org_a, 'Firma A', '27082440'), (org_b, 'Firma B', '25596641');
  insert into public.organization_members(organization_id, user_id, email, role) values
    (org_a, member_a, 'ucetni@firma-a.cz', 'admin'),
    -- čekající pozvánka: nikdo ji zatím nepřevzal
    (org_a, null, 'pozvany@firma-a.cz', 'accounting');

  -- 1) Převzatý člen svou firmu vidí.
  perform set_config('test.uid', member_a::text, true);
  perform set_config('test.email', 'ucetni@firma-a.cz', true);
  if not private.is_org_member(org_a) then raise exception 'member must see own organization'; end if;
  if private.is_org_member(org_b) then raise exception 'member must not see another organization'; end if;

  -- 2) Účet, který má jen stejný e-mail jako čekající pozvánka, nevidí nic
  --    a nemá žádnou roli (převzetí jde jen přes aplikaci s ověřeným e-mailem).
  perform set_config('test.uid', impostor::text, true);
  perform set_config('test.email', 'pozvany@firma-a.cz', true);
  if private.is_org_member(org_a) then raise exception 'unclaimed invitation e-mail must not grant read access'; end if;
  if private.has_org_role(org_a, array['accounting', 'admin']) then raise exception 'unclaimed invitation e-mail must not grant a role'; end if;

  -- 3) Účet s e-mailem člena, ale jiným user_id (uvolněná adresa po změně
  --    e-mailu) firmu nevidí.
  perform set_config('test.email', 'ucetni@firma-a.cz', true);
  if private.is_org_member(org_a) then raise exception 'e-mail alone must not grant access to a claimed membership'; end if;

  -- 4) Jedno IČO nejvýš jedné firmě, ani dodatečnou změnou v Nastavení.
  begin
    update public.organizations set ico = '27082440' where id = org_b;
    raise exception 'expected ico_taken';
  exception when unique_violation then failed := 'ok';
  end;
  if failed is distinct from 'ok' then raise exception 'IČO of another company was accepted'; end if;

  -- 5) IČO, na které už proběhla zkušební doba jiné firmy, si nikdo nevezme
  --    změnou v Nastavení (obejití „jedna zkušební doba na IČO“).
  insert into public.trial_claims(organization_id, ico) values (null, '45317054');
  failed := null;
  begin
    update public.organizations set ico = '45317054' where id = org_b;
    raise exception 'expected ico_taken';
  exception when others then failed := sqlerrm;
  end;
  if failed is distinct from 'ico_taken' then raise exception 'trial IČO takeover not blocked: %', failed; end if;
end $$;
rollback;
