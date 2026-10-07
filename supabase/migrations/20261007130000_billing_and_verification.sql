-- Předplatné Splatna, objednávky a ověření firmy datovou schránkou.
--
-- * subscriptions: jedna řádka na firmu. Nová firma začíná 30denní zkušební
--   dobou; stávající firmy (R. Hlavica) dostanou trvale aktivní předplatné,
--   takže se pro ně nic nemění.
-- * billing_orders: objednávky tarifu. Částku počítá server (src/lib/plans.ts),
--   databáze hlídá, že sedí (základ + DPH = celkem) a že zaplaceno bylo přesně.
--   Zaplacení je idempotentní: druhé oznámení od brány nic neprodlouží.
-- * organization_verifications: ověření, že firmu zakládá někdo, kdo má
--   přístup k její datové schránce (kód poslaný do DS). V DB jen otisk kódu.
-- create_organization_for_user se předefinuje se stejnou signaturou; aktuální
-- tělo bylo v 20261007120000_organization_onboarding.sql.

alter table public.organizations add column if not exists verified_at timestamptz;

create table if not exists public.subscriptions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  status text not null check (status in ('trial', 'active', 'cancelled')),
  plan text check (plan is null or plan in ('start', 'profi', 'business')),
  period text check (period is null or period in ('monthly', 'yearly')),
  trial_ends_at timestamptz,
  -- null u aktivního předplatného = bez konce (stávající firmy)
  current_period_end timestamptz,
  updated_at timestamptz not null default now(),
  check (status <> 'trial' or trial_ends_at is not null)
);

create sequence if not exists public.billing_order_number_seq;
create sequence if not exists public.splatno_invoice_number_seq;

create table if not exists public.billing_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  order_number text not null unique,
  variable_symbol text not null unique check (variable_symbol ~ '^[0-9]{10}$'),
  plan text not null check (plan in ('start', 'profi', 'business')),
  period text not null check (period in ('monthly', 'yearly')),
  months integer not null check (months in (1, 12)),
  net_halere bigint not null check (net_halere > 0),
  vat_halere bigint not null check (vat_halere >= 0),
  gross_halere bigint not null check (gross_halere = net_halere + vat_halere),
  payment_method text not null check (payment_method in ('card', 'transfer')),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  gateway_transaction_id text unique,
  billing jsonb not null default '{}'::jsonb,
  invoice_number text unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_source text,
  check ((status = 'paid') = (paid_at is not null))
);
create index if not exists billing_orders_org_created on public.billing_orders (organization_id, created_at desc);

create table if not exists public.organization_verifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  method text not null check (method in ('data_box', 'manual')),
  data_box_id text check (data_box_id is null or data_box_id ~ '^[a-z0-9]{7}$'),
  code_hash text check (code_hash is null or code_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  status text not null check (status in ('pending', 'verified', 'superseded')),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  operator_email text,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index if not exists organization_verifications_org on public.organization_verifications (organization_id, created_at desc);

-- Auditní stopa zásahů provozovatele (ruční ověření, potvrzení platby).
create table if not exists public.operator_actions (
  id uuid primary key default gen_random_uuid(),
  operator_email text not null,
  action text not null check (action in ('verify_organization', 'mark_order_paid', 'cancel_order')),
  organization_id uuid references public.organizations(id) on delete set null,
  order_id uuid references public.billing_orders(id) on delete set null,
  note text not null check (length(trim(note)) between 3 and 500),
  created_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
alter table public.billing_orders enable row level security;
alter table public.organization_verifications enable row level security;
alter table public.operator_actions enable row level security;
revoke all on public.subscriptions, public.billing_orders, public.organization_verifications, public.operator_actions from anon, authenticated;
grant select, insert, update, delete on public.subscriptions, public.billing_orders, public.organization_verifications, public.operator_actions to service_role;
grant usage, select on sequence public.billing_order_number_seq, public.splatno_invoice_number_seq to service_role;

create policy "members can view subscription" on public.subscriptions for select to authenticated
  using (private.is_org_member(organization_id));
create policy "members can view billing orders" on public.billing_orders for select to authenticated
  using (private.is_org_member(organization_id));

-- Stávající firmy (založené před předplatným) mají trvalý přístup.
create or replace function ensure_legacy_subscriptions()
returns integer language plpgsql security definer set search_path = public
as $$
declare inserted integer;
begin
  insert into subscriptions (organization_id, status, plan, period, current_period_end)
  select o.id, 'active', 'business', 'yearly', null
  from organizations o
  where not exists (select 1 from subscriptions s where s.organization_id = o.id)
    and o.created_by is null;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;
select ensure_legacy_subscriptions();

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

  insert into subscriptions (organization_id, status, trial_ends_at)
  values (org_id, 'trial', now() + interval '30 days');

  return jsonb_build_object('organization_id', org_id, 'member_id', member_id);
end;
$$;

create or replace function private.require_org_admin(target_org uuid, actor_user uuid)
returns text language plpgsql stable security definer set search_path = public
as $$
declare actor_email_value text;
begin
  select email into actor_email_value from organization_members
  where organization_id = target_org and user_id = actor_user and role = 'admin';
  if actor_email_value is null then raise exception 'insufficient_permission'; end if;
  return actor_email_value;
end;
$$;
revoke all on function private.require_org_admin(uuid, uuid) from public, anon, authenticated;
grant execute on function private.require_org_admin(uuid, uuid) to service_role;

create or replace function start_data_box_verification(
  target_org uuid, actor_user uuid, target_data_box text, code_hash text, expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare verification_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('verification:' || target_org::text, 0));
  perform private.require_org_admin(target_org, actor_user);
  if code_hash is null or code_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_code_hash'; end if;
  if target_data_box is null or lower(target_data_box) !~ '^[a-z0-9]{7}$' then raise exception 'invalid_data_box'; end if;
  update organization_verifications set status = 'superseded'
  where organization_id = target_org and status = 'pending';
  insert into organization_verifications (organization_id, method, data_box_id, code_hash, expires_at, status, created_by)
  values (target_org, 'data_box', lower(target_data_box), code_hash, expires_at, 'pending', actor_user)
  returning id into verification_id;
  return jsonb_build_object('verification_id', verification_id, 'expires_at', expires_at);
end;
$$;

-- Vrací verified | invalid | expired | locked | not_found. Každý pokus se
-- počítá; po pěti chybných už neprojde ani správný kód.
create or replace function verify_data_box_code(target_org uuid, actor_user uuid, candidate_hash text)
returns text language plpgsql security definer set search_path = public
as $$
declare row_value organization_verifications%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('verification:' || target_org::text, 0));
  perform private.require_org_admin(target_org, actor_user);
  select * into row_value from organization_verifications
  where organization_id = target_org and status = 'pending' and method = 'data_box'
  order by created_at desc limit 1 for update;
  if not found then return 'not_found'; end if;
  if row_value.expires_at <= now() then return 'expired'; end if;
  if row_value.attempts >= 5 then return 'locked'; end if;
  update organization_verifications set attempts = attempts + 1 where id = row_value.id;
  if row_value.code_hash <> candidate_hash then return 'invalid'; end if;
  update organization_verifications set status = 'verified', verified_at = now() where id = row_value.id;
  update organizations set verified_at = coalesce(verified_at, now()) where id = target_org;
  return 'verified';
end;
$$;

create or replace function operator_verify_organization(target_org uuid, operator_email text, note text)
returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from organizations where id = target_org) then raise exception 'organization_not_found'; end if;
  insert into operator_actions (operator_email, action, organization_id, note)
  values (lower(trim(operator_email)), 'verify_organization', target_org, note);
  update organization_verifications set status = 'superseded' where organization_id = target_org and status = 'pending';
  insert into organization_verifications (organization_id, method, status, note, operator_email, verified_at)
  values (target_org, 'manual', 'verified', note, lower(trim(operator_email)), now());
  update organizations set verified_at = coalesce(verified_at, now()) where id = target_org;
  return jsonb_build_object('verified', true);
end;
$$;

create or replace function create_billing_order(
  target_org uuid, actor_user uuid, target_plan text, target_period text, target_months integer,
  net bigint, vat bigint, gross bigint, method text, billing jsonb
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare order_id uuid; number_value bigint; order_number_value text; vs text;
begin
  perform private.require_org_admin(target_org, actor_user);
  if (select verified_at from organizations where id = target_org) is null then raise exception 'organization_not_verified'; end if;
  if target_plan not in ('start', 'profi', 'business') or target_period not in ('monthly', 'yearly')
    or target_months <> (case target_period when 'yearly' then 12 else 1 end) then raise exception 'invalid_plan'; end if;
  if net <= 0 or vat < 0 or gross <> net + vat then raise exception 'invalid_amount'; end if;
  if method not in ('card', 'transfer') then raise exception 'invalid_method'; end if;
  number_value := nextval('billing_order_number_seq');
  order_number_value := 'SP-' || to_char(now(), 'YYYY') || '-' || lpad(number_value::text, 6, '0');
  vs := to_char(now(), 'YY') || lpad(number_value::text, 8, '0');
  insert into billing_orders (organization_id, order_number, variable_symbol, plan, period, months,
    net_halere, vat_halere, gross_halere, payment_method, billing, created_by)
  values (target_org, order_number_value, vs, target_plan, target_period, target_months,
    net, vat, gross, method, coalesce(billing, '{}'::jsonb), actor_user)
  returning id into order_id;
  return jsonb_build_object('order_id', order_id, 'order_number', order_number_value, 'variable_symbol', vs, 'gross_halere', gross);
end;
$$;

create or replace function attach_billing_transaction(target_order uuid, transaction_id text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update billing_orders set gateway_transaction_id = transaction_id
  where id = target_order and status = 'pending' and (gateway_transaction_id is null or gateway_transaction_id = transaction_id);
  if not found then raise exception 'order_not_pending'; end if;
end;
$$;

-- Zaplacení objednávky. Idempotentní: druhé oznámení vrátí already_paid a
-- nic nemění. Částka musí sedět přesně; jinak se tarif neaktivuje.
create or replace function mark_billing_order_paid(target_order uuid, source text, transaction_id text, paid_halere bigint)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare order_row billing_orders%rowtype; sub subscriptions%rowtype; new_end timestamptz; invoice text;
begin
  select * into order_row from billing_orders where id = target_order for update;
  if not found then raise exception 'order_not_found'; end if;
  if order_row.status = 'paid' then
    return jsonb_build_object('already_paid', true, 'invoice_number', order_row.invoice_number);
  end if;
  if order_row.status <> 'pending' then raise exception 'order_not_pending'; end if;
  if paid_halere is distinct from order_row.gross_halere then raise exception 'amount_mismatch'; end if;
  if order_row.gateway_transaction_id is not null and transaction_id is distinct from order_row.gateway_transaction_id then
    raise exception 'transaction_mismatch';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('subscription:' || order_row.organization_id::text, 0));
  select * into sub from subscriptions where organization_id = order_row.organization_id for update;
  new_end := greatest(now(), coalesce(case when sub.status = 'active' then sub.current_period_end end, now()))
    + make_interval(months => order_row.months);
  invoice := 'SPF' || to_char(now(), 'YYYY') || lpad(nextval('splatno_invoice_number_seq')::text, 6, '0');

  update billing_orders set status = 'paid', paid_at = now(), paid_source = source,
    gateway_transaction_id = coalesce(gateway_transaction_id, transaction_id), invoice_number = invoice
  where id = target_order;
  insert into subscriptions (organization_id, status, plan, period, current_period_end, updated_at)
  values (order_row.organization_id, 'active', order_row.plan, order_row.period, new_end, now())
  on conflict (organization_id) do update set status = 'active', plan = excluded.plan, period = excluded.period,
    current_period_end = case when subscriptions.status = 'active' and subscriptions.current_period_end is null
      then null else excluded.current_period_end end,
    updated_at = now();
  return jsonb_build_object('already_paid', false, 'invoice_number', invoice, 'current_period_end', new_end);
end;
$$;

create or replace function operator_mark_order_paid(target_order uuid, operator_email text, note text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare order_row billing_orders%rowtype; result jsonb;
begin
  select * into order_row from billing_orders where id = target_order;
  if not found then raise exception 'order_not_found'; end if;
  result := mark_billing_order_paid(target_order, 'operator', null, order_row.gross_halere);
  insert into operator_actions (operator_email, action, organization_id, order_id, note)
  values (lower(trim(operator_email)), 'mark_order_paid', order_row.organization_id, target_order, note);
  return result;
end;
$$;

revoke all on function ensure_legacy_subscriptions() from public, anon, authenticated;
revoke all on function create_organization_for_user(uuid, jsonb) from public, anon, authenticated;
revoke all on function start_data_box_verification(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function verify_data_box_code(uuid, uuid, text) from public, anon, authenticated;
revoke all on function operator_verify_organization(uuid, text, text) from public, anon, authenticated;
revoke all on function create_billing_order(uuid, uuid, text, text, integer, bigint, bigint, bigint, text, jsonb) from public, anon, authenticated;
revoke all on function attach_billing_transaction(uuid, text) from public, anon, authenticated;
revoke all on function mark_billing_order_paid(uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function operator_mark_order_paid(uuid, text, text) from public, anon, authenticated;
grant execute on function ensure_legacy_subscriptions() to service_role;
grant execute on function create_organization_for_user(uuid, jsonb) to service_role;
grant execute on function start_data_box_verification(uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function verify_data_box_code(uuid, uuid, text) to service_role;
grant execute on function operator_verify_organization(uuid, text, text) to service_role;
grant execute on function create_billing_order(uuid, uuid, text, text, integer, bigint, bigint, bigint, text, jsonb) to service_role;
grant execute on function attach_billing_transaction(uuid, text) to service_role;
grant execute on function mark_billing_order_paid(uuid, text, text, bigint) to service_role;
grant execute on function operator_mark_order_paid(uuid, text, text) to service_role;
