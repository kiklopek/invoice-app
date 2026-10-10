-- Oddělení firem.
--
-- * private.is_org_member uznávala člena i jen podle e-mailu v JWT
--   (`or lower(m.email) = jwt.email`), bez ohledu na user_id. Kdokoli s
--   přihlášením na stejnou adresu (čekající pozvánka, uvolněná adresa po
--   změně e-mailu) tak přes REST četl data cizí firmy. has_org_role měla
--   tutéž cestu pro nepřevzaté pozvánky. Aplikace pozvánky čte servisním
--   klientem a převezme je až po potvrzení e-mailu (src/lib/invitation-claim.ts),
--   takže RLS teď uzná jen převzaté členství: user_id = auth.uid().
--   Aktuální těla obou funkcí byla v baseline; signatury a GRANTy zůstávají.
-- * IČO může patřit nejvýš jedné firmě. Dosud to hlídal jen onboarding
--   (create_organization_for_user), Nastavení → Firma dovolilo přepsat IČO
--   na cizí a obejít i pravidlo „jedna zkušební doba na IČO“ (trial_claims).

create or replace function private.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = target_org
      and m.user_id = (select auth.uid())
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
  );
$$;

create unique index if not exists organizations_ico_unique
  on public.organizations (ico) where ico is not null;

create or replace function private.guard_organization_ico_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.ico is distinct from old.ico and exists (
    select 1 from trial_claims c
    where c.ico = new.ico and c.organization_id is distinct from new.id
  ) then
    raise exception 'ico_taken';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_organization_ico_change() from public, anon, authenticated;

drop trigger if exists organizations_ico_change_guard on public.organizations;
create trigger organizations_ico_change_guard
  before update of ico on public.organizations
  for each row execute function private.guard_organization_ico_change();
