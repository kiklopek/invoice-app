-- Splatno pro více firem.
--
-- Dosud byla aplikace jedna firma (R. Hlavica) a doménu @hlavica.cz hlídal
-- constraint přímo na organization_members. Nově:
--   * doménu e-mailu hlídá firma (organizations.allowed_email_domain);
--     R. Hlavica ji má nastavenou, takže pro ni se nic nemění,
--   * firmu zakládá zakladatel naráz přes create_organization_for_user,
--   * pozvánka je čekající člen (user_id null) s jednorázovým tokenem,
--     v databázi je jen jeho SHA-256 otisk,
--   * jeden člověk patří nejvýš do jedné firmy (dokud aplikace neumí
--     přepínat firmy, druhé členství by vybíralo firmu náhodně).
-- Žádná historická migrace se nemění; add_organization_member se
-- předefinuje se stejnou signaturou (aktuální tělo bylo v baseline).

alter table public.organizations
  add column if not exists allowed_email_domain text,
  add column if not exists logo_path text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists onboarding_completed_at timestamptz;

alter table public.organizations
  add constraint organizations_allowed_email_domain_format check (
    allowed_email_domain is null
    or allowed_email_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  ),
  add constraint organizations_logo_path_format check (
    logo_path is null or logo_path ~ '^/brand/[a-z0-9_-]+\.(png|webp|svg)$'
  );

-- Stávající firmy onboarding mají za sebou. Firma, jejíž členové jsou
-- @hlavica.cz, si doménu i logo ponechá.
update public.organizations o set
  onboarding_completed_at = coalesce(o.onboarding_completed_at, o.created_at),
  allowed_email_domain = case when exists (
      select 1 from public.organization_members m
      where m.organization_id = o.id and m.email like '%@hlavica.cz'
    ) then coalesce(o.allowed_email_domain, 'hlavica.cz') else o.allowed_email_domain end,
  logo_path = case when exists (
      select 1 from public.organization_members m
      where m.organization_id = o.id and m.email like '%@hlavica.cz'
    ) then coalesce(o.logo_path, '/brand/drevohlavica.png') else o.logo_path end;

-- Pevná doména na členech pryč. Constraint nemá vlastní jméno, proto se
-- hledá podle definice; obecná kontrola formátu e-mailu ho nahradí.
do $$
declare constraint_name text;
begin
  for constraint_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.organization_members'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%hlavica%'
  loop
    execute format('alter table public.organization_members drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.organization_members
  add constraint organization_members_email_format
    check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(email) <= 254),
  add column if not exists invite_token_hash text,
  add column if not exists invite_expires_at timestamptz,
  add column if not exists invited_by uuid references auth.users(id) on delete set null,
  add column if not exists invite_sent_at timestamptz;

alter table public.organization_members
  add constraint organization_members_invite_token_format
    check (invite_token_hash is null or invite_token_hash ~ '^[a-f0-9]{64}$'),
  add constraint organization_members_invite_only_pending
    check (invite_token_hash is null or user_id is null),
  add constraint organization_members_invite_expiry
    check ((invite_token_hash is null) = (invite_expires_at is null));

create unique index if not exists organization_members_invite_token_unique
  on public.organization_members (invite_token_hash) where invite_token_hash is not null;

-- Rychlé hledání „patří tenhle e-mail už jinam?“.
create index if not exists organization_members_email_idx on public.organization_members (email);

-- Stejný algoritmus jako isValidIco v src/lib/company-validation.ts.
create or replace function private.valid_ico(value text)
returns boolean language plpgsql immutable set search_path = pg_catalog, public
as $$
declare total integer := 0; remainder integer; check_digit integer;
begin
  if value is null or value !~ '^[0-9]{8}$' then return false; end if;
  for position in 1..7 loop
    total := total + substr(value, position, 1)::integer * (9 - position);
  end loop;
  remainder := total % 11;
  check_digit := case when remainder = 0 then 1 when remainder = 1 then 0 else 11 - remainder end;
  return check_digit % 10 = substr(value, 8, 1)::integer;
end;
$$;

revoke all on function private.valid_ico(text) from public, anon, authenticated;
grant execute on function private.valid_ico(text) to service_role;

create or replace function add_organization_member(
  target_org uuid, new_email text, new_role text, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  actor_email_value text; member_id uuid; member_created timestamptz;
  event_id uuid; event_created timestamptz; normalized_email text := lower(trim(new_email));
  required_domain text;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  -- Druhý zámek na e-mail: dvě firmy nesmí stejného člověka pozvat souběžně.
  perform pg_advisory_xact_lock(hashtextextended('member-email:' || normalized_email, 0));
  if new_role not in ('viewer', 'accounting', 'admin') then raise exception 'invalid_role'; end if;
  if length(normalized_email) < 3 or length(normalized_email) > 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid_email'; end if;
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin';
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;
  select allowed_email_domain into required_domain from organizations where id = target_org;
  if required_domain is not null and split_part(normalized_email, '@', 2) <> required_domain then
    raise exception 'email_domain_not_allowed';
  end if;
  if exists (select 1 from organization_members where email = normalized_email and organization_id <> target_org) then
    raise exception 'member_of_other_organization';
  end if;
  insert into organization_members (organization_id, email, role) values (target_org, normalized_email, new_role)
  returning id, created_at into member_id, member_created;
  insert into organization_member_events (organization_id, actor_user_id, actor_email, target_member_id, target_email, event_type, new_role)
  values (target_org, actor_user, actor_email_value, member_id, normalized_email, 'added', new_role)
  returning id, created_at into event_id, event_created;
  return jsonb_build_object(
    'member', jsonb_build_object('id', member_id, 'email', normalized_email, 'role', new_role, 'user_id', null, 'created_at', member_created),
    'event', jsonb_build_object('id', event_id, 'actor_email', actor_email_value, 'target_email', normalized_email,
      'event_type', 'added', 'previous_role', null, 'new_role', new_role, 'created_at', event_created));
end;
$$;

-- Zakladatel založí firmu naráz. E-mail zakladatele se bere z auth.users,
-- ne od volajícího. Výchozí upomínky vznikají vypnuté: automat posílá
-- e-maily odběratelům, takže ho firma zapíná sama, vědomě.
create or replace function create_organization_for_user(founder_user uuid, company jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  founder_email text; org_id uuid; member_id uuid;
  company_name text := trim(coalesce(company->>'name', ''));
  company_ico text := trim(coalesce(company->>'ico', ''));
  company_email text := lower(trim(coalesce(company->>'email', '')));
  nullable_text text;
begin
  select lower(trim(email)) into founder_email from auth.users where id = founder_user;
  if founder_email is null or founder_email = '' then raise exception 'founder_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('member-email:' || founder_email, 0));
  perform pg_advisory_xact_lock(hashtextextended('organization-ico:' || company_ico, 0));

  if exists (select 1 from organization_members where user_id = founder_user and email = founder_email) then
    raise exception 'already_member';
  end if;
  if exists (select 1 from organization_members where email = founder_email) then
    raise exception 'pending_invitation';
  end if;
  if length(company_name) < 2 or length(company_name) > 200 then raise exception 'invalid_name'; end if;
  if not private.valid_ico(company_ico) then raise exception 'invalid_ico'; end if;
  if company_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid_email'; end if;
  if exists (select 1 from organizations where ico = company_ico) then raise exception 'ico_taken'; end if;

  insert into organizations (
    name, ico, dic, registered_address, operating_address, data_box_id, phone, email,
    bank_account_czk, bank_account_eur, created_by, onboarding_completed_at
  ) values (
    company_name, company_ico,
    nullif(upper(trim(coalesce(company->>'dic', ''))), ''),
    nullif(trim(coalesce(company->>'registered_address', '')), ''),
    nullif(trim(coalesce(company->>'operating_address', '')), ''),
    nullif(trim(coalesce(company->>'data_box_id', '')), ''),
    nullif(trim(coalesce(company->>'phone', '')), ''),
    company_email,
    nullif(trim(coalesce(company->>'bank_account_czk', '')), ''),
    nullif(trim(coalesce(company->>'bank_account_eur', '')), ''),
    founder_user, now()
  ) returning id into org_id;

  insert into organization_members (organization_id, user_id, email, role)
  values (org_id, founder_user, founder_email, 'admin')
  returning id into member_id;

  insert into organization_member_events (organization_id, actor_user_id, actor_email, target_member_id, target_email, event_type, new_role)
  values (org_id, founder_user, founder_email, member_id, founder_email, 'added', 'admin');

  insert into reminder_policies (organization_id, name, is_default, is_active)
  values (org_id, 'Výchozí upomínky', true, false);

  return jsonb_build_object('organization_id', org_id, 'member_id', member_id);
end;
$$;

-- Vydá (nebo znovu vydá) odkaz pozvánky. Nový token přepíše starý, takže
-- dřív poslaný odkaz přestane platit.
create or replace function issue_organization_invitation(
  target_org uuid, target_member uuid, actor_user uuid, token_hash text, expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare actor_email_value text; member_row organization_members%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_org::text, 0));
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin';
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;
  if token_hash is null or token_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_token'; end if;
  select * into member_row from organization_members
  where id = target_member and organization_id = target_org for update;
  if not found then raise exception 'member_not_found'; end if;
  if member_row.user_id is not null then raise exception 'not_pending'; end if;
  update organization_members set
    invite_token_hash = token_hash,
    invite_expires_at = expires_at,
    invited_by = actor_user,
    invite_sent_at = null
  where id = target_member;
  return jsonb_build_object('member_id', target_member, 'email', member_row.email,
    'role', member_row.role, 'expires_at', expires_at);
end;
$$;

-- Přijetí pozvánky. Odkaz platí jen pro e-mail, na který byl poslán, jen do
-- vypršení a jen jednou (token se smaže v téže transakci).
create or replace function accept_organization_invitation(token_hash text, accepting_user uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare member_row organization_members%rowtype; user_email text;
begin
  select lower(trim(email)) into user_email from auth.users where id = accepting_user;
  if user_email is null then raise exception 'user_not_found'; end if;
  select * into member_row from organization_members
  where invite_token_hash = token_hash for update;
  if not found then raise exception 'invitation_not_found'; end if;
  if member_row.invite_expires_at <= now() then raise exception 'invitation_expired'; end if;
  if member_row.email <> user_email then raise exception 'email_mismatch'; end if;
  if exists (select 1 from organization_members
      where user_id = accepting_user and organization_id <> member_row.organization_id) then
    raise exception 'member_of_other_organization';
  end if;
  update organization_members set
    user_id = accepting_user,
    invite_token_hash = null,
    invite_expires_at = null
  where id = member_row.id;
  return jsonb_build_object('organization_id', member_row.organization_id,
    'member_id', member_row.id, 'role', member_row.role, 'email', member_row.email);
end;
$$;

revoke all on function add_organization_member(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function create_organization_for_user(uuid, jsonb) from public, anon, authenticated;
revoke all on function issue_organization_invitation(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function accept_organization_invitation(text, uuid) from public, anon, authenticated;
grant execute on function add_organization_member(uuid, text, text, uuid) to service_role;
grant execute on function create_organization_for_user(uuid, jsonb) to service_role;
grant execute on function issue_organization_invitation(uuid, uuid, uuid, text, timestamptz) to service_role;
grant execute on function accept_organization_invitation(text, uuid) to service_role;
