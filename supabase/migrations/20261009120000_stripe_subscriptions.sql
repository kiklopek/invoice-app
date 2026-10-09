-- Předplatné přes Stripe se zkušební dobou 14 dní / 50 faktur.
--
-- * Nová firma začíná ve stavu `incomplete` (bez karty). Kartu zadá v
--   onboardingu; teprve pak Stripe založí předplatné (se zkušební dobou,
--   má-li firma nárok) a webhook stav zrcadlí sem.
-- * Stavy odpovídají Stripe: incomplete / trialing / active / past_due /
--   canceled / unpaid / incomplete_expired / paused. Stávající `active` bez
--   Stripe (R. Hlavica a firmy před předplatným) zůstává a nic se pro ně nemění.
-- * Limit faktur ve zkušební době hlídá trigger s čítačem (mazáním faktur se
--   limit nevrací) a zámkem na řádek předplatného (souběžné vkládání ho
--   nepřeleze). Firmy bez řádku v subscriptions trigger nijak neomezuje.
-- * trial_claims: komu už zkušební doba proběhla. Jedna na IČO (i po smazání
--   firmy), jedna na kartu (otisk karty ze Stripe), nejvýš 3 za 30 dní z
--   jedné IP (jen HMAC otisk, po 90 dnech se maže).
-- * Zrcadlení ze Stripe nikdy tiše nepřepíše zákazníka ani běžící předplatné
--   jiné firmy (customer_mismatch / subscription_mismatch) a starší událost
--   nepřepíše novější stav.
-- * Ruční objednávky (Comgate/převod) a ověření datovou schránkou se ruší.
--   Jejich funkce se odstraňují; tabulky zůstávají (jsou prázdné) kvůli
--   auditní stopě a nic se z nich nemaže.
--
-- create_organization_for_user se předefinuje se stejnou signaturou; aktuální
-- tělo bylo v 20261007125359_billing_and_verification.sql.

-- Stavy: nejdřív pryč staré constrainty, pak převod hodnot, pak nové.
do $$
declare constraint_name text;
begin
  for constraint_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.subscriptions'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%status%'
  loop
    execute format('alter table public.subscriptions drop constraint %I', constraint_name);
  end loop;
end $$;

update public.subscriptions set status = 'trialing' where status = 'trial';
update public.subscriptions set status = 'canceled' where status = 'cancelled';

alter table public.subscriptions
  add column if not exists stripe_customer_id text unique,
  add column if not exists stripe_subscription_id text unique,
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_invoice_limit integer not null default 50,
  add column if not exists trial_invoices_used integer not null default 0,
  add column if not exists trial_denied_reason text,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists scheduled_plan text,
  add column if not exists scheduled_period text,
  add column if not exists scheduled_at timestamptz,
  add column if not exists stripe_synced_at timestamptz;

alter table public.subscriptions
  add constraint subscriptions_status_known check (status in (
    'incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete_expired', 'paused'
  )),
  add constraint subscriptions_trial_limit check (trial_invoice_limit > 0 and trial_invoices_used >= 0),
  add constraint subscriptions_trial_denied check (trial_denied_reason is null or trial_denied_reason in ('ico_used', 'card_used', 'ip_limit')),
  add constraint subscriptions_scheduled_plan check (scheduled_plan is null or scheduled_plan in ('start', 'profi', 'business')),
  add constraint subscriptions_scheduled_period check (scheduled_period is null or scheduled_period in ('monthly', 'yearly'));

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

create table if not exists public.trial_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid unique references public.organizations(id) on delete set null,
  ico text not null unique check (ico ~ '^[0-9]{8}$'),
  card_fingerprint text unique,
  ip_hash text check (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
create index if not exists trial_claims_ip on public.trial_claims (ip_hash, created_at) where ip_hash is not null;

alter table public.stripe_events enable row level security;
alter table public.trial_claims enable row level security;
revoke all on public.stripe_events, public.trial_claims from anon, authenticated;
grant select, insert, update, delete on public.stripe_events, public.trial_claims to service_role;

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

  -- Bez karty: zkušební doba začne až po jejím zadání (Stripe).
  insert into subscriptions (organization_id, status)
  values (org_id, 'incomplete');

  return jsonb_build_object('organization_id', org_id, 'member_id', member_id);
end;
$$;

-- Nárok na zkušební dobu. Vrací eligible | ico_used | card_used | ip_limit.
-- Pro firmu, která už nárok uplatnila, vrací znovu eligible (webhook i návrat
-- z platební brány mohou přijít oba).
create or replace function claim_trial(target_org uuid, target_fingerprint text, target_ip_hash text)
returns text language plpgsql security definer set search_path = public
as $$
declare org_ico text;
begin
  -- Nároků je málo; jeden globální zámek je nejjednodušší ochrana proti souběhu.
  perform pg_advisory_xact_lock(hashtextextended('trial-claim', 0));
  update trial_claims t set ip_hash = null where t.ip_hash is not null and t.created_at < now() - interval '90 days';
  if exists (select 1 from trial_claims t where t.organization_id = target_org) then return 'eligible'; end if;
  select o.ico into org_ico from organizations o where o.id = target_org;
  if org_ico is null then raise exception 'organization_not_found'; end if;
  if exists (select 1 from trial_claims t where t.ico = org_ico) then return 'ico_used'; end if;
  if target_fingerprint is not null and exists (select 1 from trial_claims t where t.card_fingerprint = target_fingerprint) then
    return 'card_used';
  end if;
  if target_ip_hash is not null and (
      select count(*) from trial_claims t
      where t.ip_hash = target_ip_hash and t.created_at > now() - interval '30 days'
    ) >= 3 then
    return 'ip_limit';
  end if;
  insert into trial_claims (organization_id, ico, card_fingerprint, ip_hash)
  values (target_org, org_ico, target_fingerprint, target_ip_hash);
  return 'eligible';
end;
$$;

-- Propojení firmy se zákazníkem ve Stripe. Jiného zákazníka tiše nepřepíše.
create or replace function link_stripe_customer(target_org uuid, customer_id text)
returns void language plpgsql security definer set search_path = public
as $$
declare existing text;
begin
  if customer_id is null or customer_id !~ '^cus_[A-Za-z0-9]+$' then raise exception 'invalid_customer'; end if;
  select stripe_customer_id into existing from subscriptions where organization_id = target_org for update;
  if not found then raise exception 'subscription_not_found'; end if;
  if existing is not null and existing <> customer_id then raise exception 'customer_mismatch'; end if;
  update subscriptions set stripe_customer_id = customer_id, updated_at = now() where organization_id = target_org;
end;
$$;

-- Zrcadlení stavu předplatného ze Stripe. Vrací updated | stale.
create or replace function sync_stripe_subscription(target_org uuid, payload jsonb)
returns text language plpgsql security definer set search_path = public
as $$
declare
  row_value subscriptions%rowtype;
  observed timestamptz := coalesce((payload->>'observed_at')::timestamptz, now());
  new_status text := payload->>'status';
  customer text := payload->>'customer_id';
  subscription text := payload->>'subscription_id';
begin
  select * into row_value from subscriptions where organization_id = target_org for update;
  if not found then raise exception 'subscription_not_found'; end if;
  if customer is null or subscription is null then raise exception 'invalid_payload'; end if;
  if row_value.stripe_customer_id is not null and row_value.stripe_customer_id <> customer then
    raise exception 'customer_mismatch';
  end if;
  -- Stávající předplatné bez Stripe (R. Hlavica) se tímhle nepřepisuje.
  if row_value.stripe_customer_id is null and row_value.status = 'active' and row_value.stripe_subscription_id is null then
    raise exception 'legacy_subscription';
  end if;
  if row_value.stripe_subscription_id is not null and row_value.stripe_subscription_id <> subscription
    and row_value.status not in ('canceled', 'incomplete_expired') then
    raise exception 'subscription_mismatch';
  end if;
  if row_value.stripe_synced_at is not null and observed < row_value.stripe_synced_at then
    return 'stale';
  end if;

  update subscriptions set
    stripe_customer_id = customer,
    stripe_subscription_id = subscription,
    status = new_status,
    plan = coalesce(payload->>'plan', plan),
    period = coalesce(payload->>'period', period),
    trial_ends_at = (payload->>'trial_ends_at')::timestamptz,
    trial_started_at = case
      when new_status = 'trialing' then coalesce(trial_started_at, now())
      else trial_started_at end,
    current_period_end = (payload->>'current_period_end')::timestamptz,
    cancel_at_period_end = coalesce((payload->>'cancel_at_period_end')::boolean, false),
    scheduled_plan = payload->>'scheduled_plan',
    scheduled_period = payload->>'scheduled_period',
    scheduled_at = (payload->>'scheduled_at')::timestamptz,
    stripe_synced_at = observed,
    updated_at = now()
  where organization_id = target_org;
  return 'updated';
end;
$$;

-- Webhook: true, pokud se událost vidí poprvé.
create or replace function record_stripe_event(event_id text, event_type text)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  insert into stripe_events (id, type) values (event_id, event_type) on conflict (id) do nothing;
  return found;
end;
$$;

-- Faktury podle stavu předplatného. Firma bez řádku v subscriptions
-- (data před zavedením předplatného) se neomezuje.
create or replace function private.enforce_invoice_subscription()
returns trigger language plpgsql security definer set search_path = public
as $$
declare row_value subscriptions%rowtype;
begin
  select * into row_value from subscriptions where organization_id = new.organization_id for update;
  if not found then return new; end if;
  if row_value.status in ('incomplete', 'incomplete_expired') then raise exception 'subscription_payment_required'; end if;
  if row_value.status in ('canceled', 'unpaid', 'paused') then raise exception 'subscription_expired'; end if;
  if row_value.status = 'trialing' then
    if row_value.trial_invoices_used >= row_value.trial_invoice_limit then raise exception 'trial_invoice_limit'; end if;
    update subscriptions set trial_invoices_used = trial_invoices_used + 1 where organization_id = new.organization_id;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_invoice_subscription() from public, anon, authenticated;

drop trigger if exists invoices_subscription_limit on public.invoices;
create trigger invoices_subscription_limit
  before insert on public.invoices
  for each row execute function private.enforce_invoice_subscription();

-- Ruční objednávky a ověření datovou schránkou se už nepoužívají.
drop function if exists operator_mark_order_paid(uuid, text, text);
drop function if exists mark_billing_order_paid(uuid, text, text, bigint);
drop function if exists attach_billing_transaction(uuid, text);
drop function if exists create_billing_order(uuid, uuid, text, text, integer, bigint, bigint, bigint, text, jsonb);
drop function if exists operator_verify_organization(uuid, text, text);
drop function if exists verify_data_box_code(uuid, uuid, text);
drop function if exists start_data_box_verification(uuid, uuid, text, text, timestamptz);

revoke all on function create_organization_for_user(uuid, jsonb) from public, anon, authenticated;
revoke all on function claim_trial(uuid, text, text) from public, anon, authenticated;
revoke all on function link_stripe_customer(uuid, text) from public, anon, authenticated;
revoke all on function sync_stripe_subscription(uuid, jsonb) from public, anon, authenticated;
revoke all on function record_stripe_event(text, text) from public, anon, authenticated;
grant execute on function create_organization_for_user(uuid, jsonb) to service_role;
grant execute on function claim_trial(uuid, text, text) to service_role;
grant execute on function link_stripe_customer(uuid, text) to service_role;
grant execute on function sync_stripe_subscription(uuid, jsonb) to service_role;
grant execute on function record_stripe_event(text, text) to service_role;
