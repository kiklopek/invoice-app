-- Splatno Síť: propojení firem a vzájemná fakturace mezi nimi.
--
-- Model (viz docs/partner-network.md):
-- * Propojení je firma↔firma, vzniká žádostí a přijetím (nebo přijetím
--   pozvánky, kterou poslala druhá strana). Dokud není aktivní, nevidí nikdo nic.
-- * Nic se nekopíruje. Faktura má jediného vlastníka -- vystavitele. Partner ji
--   jen čte přes propojení: faktura X -> Y je vidět, když ji vystavila firma X
--   na IČO firmy Y (counterparty_ico normalizované na číslice) a propojení X↔Y
--   je aktivní. Závazek Y vůči X je tak přesně pohledávka X vůči Y.
-- * Rozsah sdílení: faktury vystavené od propojení a faktury, které v okamžiku
--   propojení byly otevřené. Zaplacenou historii sdílí každá strana sama
--   (requester_/addressee_share_history).
-- * Firma je v síti dosažitelná jen tehdy, když její IČO má v organizations
--   právě jednu firmu. Nejednoznačné IČO se nikdy tiše nepřiřadí.
-- * IČO obou stran se při vzniku propojení zapíše do propojení a viditelnost se
--   počítá z něj, ne z aktuálního organizations.ico. Změna IČO firmy její
--   propojení zruší (trigger níže), takže přepsání IČO v nastavení nikdy
--   neukáže faktury jiné firmy.
-- * Faktury otevřené v okamžiku propojení se zapíší do open_snapshot; zůstanou
--   vidět i po úhradě, i když banka platbu zaúčtuje se zpětným datem.
-- * Partner nikdy nemění peníze vystavitele. Rozpor nebo oznámená platba je
--   samostatný záznam (network_invoice_flags), o stavu faktury dál rozhoduje
--   vystavitel stávajícími cestami (párování, confirm_manual_payment).
--
-- Všechny tabulky mají RLS bez policy pro klienty; čte a zapisuje se jen přes
-- funkce níže (service_role), které organizaci a uživatele dostávají z identity
-- v API route a samy ověřují roli i aktivní propojení.

create table if not exists public.organization_connections (
  id uuid primary key default gen_random_uuid(),
  requester_org uuid not null references public.organizations(id) on delete cascade,
  addressee_org uuid not null references public.organizations(id) on delete cascade,
  requester_ico text not null check (requester_ico ~ '^[0-9]{8}$'),
  addressee_ico text not null check (addressee_ico ~ '^[0-9]{8}$'),
  open_snapshot uuid[] not null default '{}',
  org_low uuid generated always as (least(requester_org, addressee_org)) stored,
  org_high uuid generated always as (greatest(requester_org, addressee_org)) stored,
  status text not null default 'pending' check (status in ('pending', 'active', 'declined', 'revoked')),
  origin text not null default 'search' check (origin in ('search', 'suggestion', 'invitation')),
  message text check (message is null or char_length(message) <= 500),
  requested_by uuid references auth.users(id) on delete set null,
  requested_by_email text,
  responded_by uuid references auth.users(id) on delete set null,
  responded_at timestamptz,
  activated_at timestamptz,
  revoked_by_org uuid references public.organizations(id) on delete set null,
  revoked_at timestamptz,
  requester_share_history boolean not null default false,
  addressee_share_history boolean not null default false,
  created_at timestamptz not null default now(),
  check (requester_org <> addressee_org),
  check ((status = 'active') = (activated_at is not null) or status = 'revoked')
);

create unique index if not exists organization_connections_live_pair
  on public.organization_connections (org_low, org_high)
  where status in ('pending', 'active');
create index if not exists organization_connections_requester_idx on public.organization_connections (requester_org, status);
create index if not exists organization_connections_addressee_idx on public.organization_connections (addressee_org, status);

create table if not exists public.organization_connection_events (
  id bigint generated always as identity primary key,
  connection_id uuid references public.organization_connections(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'requested', 'accepted', 'declined', 'cancelled', 'revoked', 'share_history_changed',
    'invitation_issued', 'invitation_accepted', 'flag_created', 'flag_resolved'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists organization_connection_events_connection_idx on public.organization_connection_events (connection_id, created_at);
create index if not exists organization_connection_events_org_idx on public.organization_connection_events (organization_id, created_at);

create table if not exists public.network_invoice_flags (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.organization_connections(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  issuer_org uuid not null references public.organizations(id) on delete cascade,
  recipient_org uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('disputed', 'payment_claimed')),
  reason text check (reason is null or reason in ('price', 'quantity', 'not_delivered', 'duplicate', 'other')),
  note text check (note is null or char_length(note) <= 1000),
  claimed_paid_on date,
  claimed_amount numeric(14,2) check (claimed_amount is null or claimed_amount > 0),
  status text not null default 'open' check (status in ('open', 'resolved', 'rejected', 'withdrawn')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  check (issuer_org <> recipient_org),
  check ((kind = 'disputed' and reason is not null) or (kind = 'payment_claimed' and claimed_paid_on is not null and claimed_amount is not null)),
  check ((status = 'open') = (decided_at is null))
);
create unique index if not exists network_invoice_flags_one_open
  on public.network_invoice_flags (invoice_id, kind) where status = 'open';
create index if not exists network_invoice_flags_issuer_idx on public.network_invoice_flags (issuer_org, status);
create index if not exists network_invoice_flags_recipient_idx on public.network_invoice_flags (recipient_org, status);

create table if not exists public.network_invitations (
  id uuid primary key default gen_random_uuid(),
  inviter_org uuid not null references public.organizations(id) on delete cascade,
  invited_by uuid references auth.users(id) on delete set null,
  invitee_ico text not null check (invitee_ico ~ '^[0-9]{8}$'),
  invitee_email text not null check (invitee_email = lower(invitee_email) and invitee_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  sent_at timestamptz,
  send_count integer not null default 0,
  accepted_org uuid references public.organizations(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check ((accepted_org is null) = (accepted_at is null))
);
create unique index if not exists network_invitations_open_pair
  on public.network_invitations (inviter_org, invitee_ico) where accepted_at is null;

-- Každý vydaný odkaz pozvánky (i po připomínce s novým odkazem) dál funguje
-- pro náhled a odhlášení; odhlášení platí pro adresu, na kterou odkaz odešel.
create table if not exists public.network_invitation_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  invitation_id uuid not null references public.network_invitations(id) on delete cascade,
  email text not null check (email = lower(email)),
  created_at timestamptz not null default now()
);
create index if not exists network_invitation_tokens_invitation_idx on public.network_invitation_tokens (invitation_id);

-- Adresy, které si další pozvánky do Splatna nepřejí (odkaz v každé pozvánce).
-- Platí pro všechny firmy: zákon 480/2004 Sb. odpovědnost nedělí podle odesílatele.
create table if not exists public.network_invitation_optouts (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

-- Atribuce pro budoucí odměny za doporučení. Nic se z ní zatím nepočítá.
alter table public.organizations add column if not exists referred_by_org uuid references public.organizations(id) on delete set null;

alter table public.organization_connections enable row level security;
alter table public.organization_connection_events enable row level security;
alter table public.network_invoice_flags enable row level security;
alter table public.network_invitations enable row level security;
alter table public.network_invitation_optouts enable row level security;
alter table public.network_invitation_tokens enable row level security;
revoke all on public.organization_connections, public.organization_connection_events,
  public.network_invoice_flags, public.network_invitations, public.network_invitation_optouts,
  public.network_invitation_tokens from anon, authenticated;
grant select, insert, update, delete on public.organization_connections, public.organization_connection_events,
  public.network_invoice_flags, public.network_invitations, public.network_invitation_optouts,
  public.network_invitation_tokens to service_role;

-- ---------------------------------------------------------------------------
-- Pomocné funkce
-- ---------------------------------------------------------------------------

create or replace function private.normalized_ico(value text)
returns text language sql immutable set search_path = pg_catalog, public
as $$ select nullif(regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g'), '') $$;

-- Firma je v síti dosažitelná, jen když její IČO patří právě jí.
create or replace function private.network_org_ready(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from organizations o where o.id = target_org
      and (select count(*) from organizations d where d.ico = o.ico) = 1
  )
$$;

-- Role volajícího ve firmě; viewer ani nečlen síť nevidí.
create or replace function private.network_actor_role(target_org uuid, actor_user uuid, need_admin boolean)
returns text language plpgsql stable security definer set search_path = public
as $$
declare actor_role text;
begin
  select role into actor_role from organization_members
  where organization_id = target_org and user_id = actor_user;
  if actor_role is null or actor_role not in ('accounting', 'admin') then raise exception 'insufficient_permission'; end if;
  if need_admin and actor_role <> 'admin' then raise exception 'insufficient_permission'; end if;
  return actor_role;
end;
$$;

-- Faktury, které vystavitel `issuer` sdílí přes propojení `conn_id` s druhou stranou.
-- Jediné místo s pravidlem viditelnosti; volají ho všechny čtecí funkce.
-- Importovaná faktura s počátečním stavem úhrady: datum úhrady je datum
-- importu, ne skutečné platby (viz record_initial_invoice_payment).
create or replace function private.network_initially_paid(i public.invoices)
returns boolean language sql immutable set search_path = pg_catalog, public
as $$ select coalesce((i.money_evidence->>'initial_paid')::numeric, 0) >= i.amount $$;

create or replace function private.network_shared_invoices(conn_id uuid, issuer uuid)
returns setof public.invoices language sql stable security definer set search_path = public
as $$
  select i.*
  from organization_connections c
  join invoices i on i.organization_id = issuer
  where c.id = conn_id
    and c.status = 'active'
    and issuer in (c.requester_org, c.addressee_org)
    and i.status <> 'cancelled'
    -- IČO partnera z okamžiku propojení, ne aktuální hodnota z nastavení.
    and private.normalized_ico(i.counterparty_ico) = case when c.requester_org = issuer then c.addressee_ico else c.requester_ico end
    and (
      i.id = any(c.open_snapshot)
      or (i.created_at >= c.activated_at and not private.network_initially_paid(i))
      or case when c.requester_org = issuer then c.requester_share_history else c.addressee_share_history end
    )
$$;

-- Aktivace propojení: jediné místo, kde se zapisuje okamžik propojení a seznam
-- faktur obou stran, které v tu chvíli byly otevřené.
create or replace function private.network_activate(conn_id uuid, actor_user uuid)
returns void language sql security definer set search_path = public
as $$
  update organization_connections c set
    status = 'active',
    responded_by = actor_user,
    responded_at = now(),
    activated_at = now(),
    open_snapshot = coalesce((
      select array_agg(i.id) from invoices i
      where i.status in ('pending', 'overdue')
        and ((i.organization_id = c.requester_org and private.normalized_ico(i.counterparty_ico) = c.addressee_ico)
          or (i.organization_id = c.addressee_org and private.normalized_ico(i.counterparty_ico) = c.requester_ico))
    ), '{}')
  where c.id = conn_id
$$;

-- Zobrazovaný stav: pending po splatnosti je overdue hned, ne až po cronu.
create or replace function private.network_invoice_state(i public.invoices)
returns text language sql stable set search_path = pg_catalog, public
as $$
  select case when i.status = 'pending' and i.due_date < current_date then 'overdue' else i.status end
$$;

-- Bilance jedné strany vůči druhé: per měna, co mi dluží (issued by me) a co dlužím já.
create or replace function private.network_balance(conn_id uuid, me uuid, partner uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  with shared as (
    select 'out' as dir, i.currency, i.amount - i.paid_amount as open_amount, i.due_date
    from private.network_shared_invoices(conn_id, me) i where i.status in ('pending', 'overdue')
    union all
    select 'in' as dir, i.currency, i.amount - i.paid_amount as open_amount, i.due_date
    from private.network_shared_invoices(conn_id, partner) i where i.status in ('pending', 'overdue')
  )
  select coalesce(jsonb_agg(b order by b->>'currency'), '[]'::jsonb) from (
    select jsonb_build_object(
      'currency', currency,
      'they_owe', coalesce(sum(open_amount) filter (where dir = 'out'), 0),
      'we_owe', coalesce(sum(open_amount) filter (where dir = 'in'), 0),
      'they_overdue', coalesce(sum(open_amount) filter (where dir = 'out' and due_date < current_date), 0),
      'we_overdue', coalesce(sum(open_amount) filter (where dir = 'in' and due_date < current_date), 0),
      'they_count', count(*) filter (where dir = 'out'),
      'we_count', count(*) filter (where dir = 'in')
    ) b
    from shared group by currency
  ) t
$$;

-- Profil partnera: jen to, co stejně stojí na jeho fakturách.
create or replace function private.network_org_card(target uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('id', o.id, 'name', o.name, 'ico', o.ico, 'dic', o.dic,
    'address', coalesce(o.registered_address, o.operating_address), 'logo_path', o.logo_path)
  from organizations o where o.id = target
$$;

create or replace function private.network_log(conn_id uuid, target_org uuid, actor_user uuid, kind text, details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public
as $$
  insert into organization_connection_events (connection_id, organization_id, actor_user_id, event_type, details)
  values (conn_id, target_org, actor_user, kind, coalesce(details, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- Propojení
-- ---------------------------------------------------------------------------

-- Co se stane, když admin zadá IČO. Prozradí jen název firmy, kterou lze oslovit.
create or replace function network_lookup(target_org uuid, actor_user uuid, target_ico text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  wanted text := private.normalized_ico(target_ico);
  own_ico text;
  matches integer;
  partner organizations%rowtype;
  conn organization_connections%rowtype;
begin
  perform private.network_actor_role(target_org, actor_user, true);
  if wanted is null or not private.valid_ico(wanted) then return jsonb_build_object('state', 'invalid_ico'); end if;
  select ico into own_ico from organizations where id = target_org;
  if own_ico = wanted then return jsonb_build_object('state', 'self'); end if;
  if not private.network_org_ready(target_org) then return jsonb_build_object('state', 'own_ico_ambiguous'); end if;
  select count(*) into matches from organizations where ico = wanted;
  if matches = 0 then return jsonb_build_object('state', 'not_on_network', 'ico', wanted); end if;
  if matches > 1 then return jsonb_build_object('state', 'ambiguous', 'ico', wanted); end if;
  select * into partner from organizations where ico = wanted;
  select * into conn from organization_connections
  where org_low = least(target_org, partner.id) and org_high = greatest(target_org, partner.id)
    and status in ('pending', 'active');
  return jsonb_build_object(
    'state', case
      when conn.id is null then 'available'
      when conn.status = 'active' then 'connected'
      when conn.requester_org = target_org then 'pending_outgoing'
      else 'pending_incoming' end,
    'ico', wanted,
    'connection_id', conn.id,
    'partner', jsonb_build_object('name', partner.name, 'ico', partner.ico, 'logo_path', partner.logo_path)
  );
end;
$$;

create or replace function network_request(target_org uuid, actor_user uuid, target_ico text, request_message text, request_origin text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  wanted text := private.normalized_ico(target_ico);
  actor_email text;
  partner_id uuid;
  conn organization_connections%rowtype;
  clean_message text := nullif(trim(coalesce(request_message, '')), '');
begin
  actor_email := private.require_org_admin(target_org, actor_user);
  if request_origin is null or request_origin not in ('search', 'suggestion') then raise exception 'invalid_origin'; end if;
  if wanted is null or not private.valid_ico(wanted) then raise exception 'invalid_ico'; end if;
  if clean_message is not null and char_length(clean_message) > 500 then raise exception 'message_too_long'; end if;
  if not private.network_org_ready(target_org) then raise exception 'own_ico_ambiguous'; end if;
  if (select ico from organizations where id = target_org) = wanted then raise exception 'self_connection'; end if;
  if (select count(*) from organizations where ico = wanted) <> 1 then raise exception 'partner_not_found'; end if;
  select id into partner_id from organizations where ico = wanted;

  perform pg_advisory_xact_lock(hashtextextended('network-pair:' || least(target_org, partner_id)::text || greatest(target_org, partner_id)::text, 0));

  select * into conn from organization_connections
  where org_low = least(target_org, partner_id) and org_high = greatest(target_org, partner_id)
    and status in ('pending', 'active') for update;
  if conn.id is not null and conn.status = 'active' then raise exception 'already_connected'; end if;
  if conn.id is not null and conn.requester_org = target_org then raise exception 'already_pending'; end if;
  if conn.id is not null then
    -- Protistrana už žádala: naše žádost je její přijetí.
    perform private.network_activate(conn.id, actor_user);
    perform private.network_log(conn.id, target_org, actor_user, 'accepted', jsonb_build_object('via', 'mutual_request'));
    return jsonb_build_object('connection_id', conn.id, 'status', 'active');
  end if;

  -- Ochrana proti obtěžování: odmítnutou žádost nejde 30 dní opakovat a denní strop.
  if exists (select 1 from organization_connections where requester_org = target_org and addressee_org = partner_id
      and status = 'declined' and responded_at > now() - interval '30 days') then
    raise exception 'recently_declined';
  end if;
  if (select count(*) from organization_connections where requester_org = target_org and created_at > now() - interval '1 day') >= 30 then
    raise exception 'daily_limit';
  end if;

  insert into organization_connections (requester_org, addressee_org, requester_ico, addressee_ico, status, origin, message, requested_by, requested_by_email)
  values (target_org, partner_id, (select ico from organizations where id = target_org), wanted, 'pending', request_origin, clean_message, actor_user, actor_email)
  returning * into conn;
  perform private.network_log(conn.id, target_org, actor_user, 'requested', jsonb_build_object('origin', request_origin));
  return jsonb_build_object('connection_id', conn.id, 'status', 'pending');
end;
$$;

create or replace function network_respond(target_org uuid, actor_user uuid, target_connection uuid, accept boolean)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare conn organization_connections%rowtype;
begin
  perform private.require_org_admin(target_org, actor_user);
  if accept is null then raise exception 'invalid_decision'; end if;
  select * into conn from organization_connections where id = target_connection for update;
  if conn.id is null or conn.addressee_org <> target_org then raise exception 'connection_not_found'; end if;
  if conn.status <> 'pending' then raise exception 'not_pending'; end if;
  if accept and not (private.network_org_ready(conn.requester_org) and private.network_org_ready(target_org)) then
    raise exception 'own_ico_ambiguous';
  end if;
  if accept then
    perform private.network_activate(conn.id, actor_user);
  else
    update organization_connections set status = 'declined', responded_by = actor_user, responded_at = now() where id = conn.id;
  end if;
  perform private.network_log(conn.id, target_org, actor_user, case when accept then 'accepted' else 'declined' end);
  return jsonb_build_object('connection_id', conn.id, 'status', case when accept then 'active' else 'declined' end);
end;
$$;

-- Zrušení: odchozí žádost (cancelled) nebo aktivní propojení (revoked). Přístup končí okamžitě.
create or replace function network_revoke(target_org uuid, actor_user uuid, target_connection uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare conn organization_connections%rowtype;
begin
  perform private.require_org_admin(target_org, actor_user);
  select * into conn from organization_connections where id = target_connection for update;
  if conn.id is null or target_org not in (conn.requester_org, conn.addressee_org) then raise exception 'connection_not_found'; end if;
  if conn.status = 'pending' and conn.requester_org <> target_org then raise exception 'use_decline'; end if;
  if conn.status not in ('pending', 'active') then raise exception 'not_active'; end if;
  update organization_connections set status = 'revoked', revoked_by_org = target_org, revoked_at = now() where id = conn.id;
  update network_invoice_flags set status = 'withdrawn', decided_at = now(), decided_by = actor_user,
    resolution_note = 'Propojení bylo zrušeno.'
  where connection_id = conn.id and status = 'open';
  perform private.network_log(conn.id, target_org, actor_user, case when conn.status = 'pending' then 'cancelled' else 'revoked' end);
  return jsonb_build_object('connection_id', conn.id, 'status', 'revoked');
end;
$$;

create or replace function network_set_share_history(target_org uuid, actor_user uuid, target_connection uuid, share boolean)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare conn organization_connections%rowtype;
begin
  perform private.require_org_admin(target_org, actor_user);
  if share is null then raise exception 'invalid_decision'; end if;
  select * into conn from organization_connections where id = target_connection for update;
  if conn.id is null or target_org not in (conn.requester_org, conn.addressee_org) then raise exception 'connection_not_found'; end if;
  if conn.status <> 'active' then raise exception 'not_active'; end if;
  if conn.requester_org = target_org then
    update organization_connections set requester_share_history = share where id = conn.id;
  else
    update organization_connections set addressee_share_history = share where id = conn.id;
  end if;
  perform private.network_log(conn.id, target_org, actor_user, 'share_history_changed', jsonb_build_object('share', share));
  return jsonb_build_object('connection_id', conn.id, 'share_history', share);
end;
$$;

-- ---------------------------------------------------------------------------
-- Čtení
-- ---------------------------------------------------------------------------

create or replace function network_overview(target_org uuid, actor_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  actor_role text;
  own organizations%rowtype;
  connections jsonb;
  suggestions jsonb;
  invite_candidates jsonb;
  invitations jsonb;
begin
  actor_role := private.network_actor_role(target_org, actor_user, false);
  select * into own from organizations where id = target_org;

  select coalesce(jsonb_agg(row_data order by sort_key, partner_name), '[]'::jsonb) into connections from (
    select
      case c.status when 'pending' then 0 else 1 end as sort_key,
      p.name as partner_name,
      jsonb_build_object(
        'id', c.id,
        'status', c.status,
        'direction', case when c.requester_org = target_org then 'outgoing' else 'incoming' end,
        'origin', c.origin,
        'message', c.message,
        'created_at', c.created_at,
        'activated_at', c.activated_at,
        'requested_by_email', case when c.addressee_org = target_org then c.requested_by_email end,
        'partner', private.network_org_card(p.id),
        'balances', case when c.status = 'active' then private.network_balance(c.id, target_org, p.id) else '[]'::jsonb end,
        'open_flags', case when c.status = 'active' then (
          select count(*) from network_invoice_flags f where f.connection_id = c.id and f.status = 'open'
            and f.issuer_org = target_org) else 0 end,
        -- U příchozí žádosti: kolik mých otevřených faktur partner po přijetí uvidí,
        -- a jestli e-mail žadatele odpovídá kontaktu z mých faktur (doména).
        'preview', case when c.status = 'pending' and c.addressee_org = target_org then (
          select jsonb_build_object(
            'open_count', count(*),
            'open_totals', coalesce((select jsonb_object_agg(cur, total) from (
                select i2.currency cur, sum(i2.amount - i2.paid_amount) total from invoices i2
                where i2.organization_id = target_org and i2.status in ('pending', 'overdue')
                  and private.normalized_ico(i2.counterparty_ico) = p.ico group by i2.currency) t), '{}'::jsonb),
            'email_domain_match', case
              when c.requested_by_email is null then null
              when not exists (select 1 from invoices i3 where i3.organization_id = target_org
                and private.normalized_ico(i3.counterparty_ico) = p.ico) then null
              else exists (select 1 from invoices i4 where i4.organization_id = target_org
                and private.normalized_ico(i4.counterparty_ico) = p.ico
                and split_part(lower(i4.counterparty_email), '@', 2) = split_part(lower(c.requested_by_email), '@', 2))
              end)
          from invoices i where i.organization_id = target_org and i.status in ('pending', 'overdue')
            and private.normalized_ico(i.counterparty_ico) = p.ico) end
      ) as row_data
    from organization_connections c
    join organizations p on p.id = case when c.requester_org = target_org then c.addressee_org else c.requester_org end
    where target_org in (c.requester_org, c.addressee_org) and c.status in ('pending', 'active')
  ) t;

  -- Návrhy: firmy v síti, se kterými už obchodujeme (fakturujeme jim nebo ony nám).
  select coalesce(jsonb_agg(s order by (s->>'invoice_count')::int desc), '[]'::jsonb) into suggestions from (
    select jsonb_build_object(
      'partner', private.network_org_card(o.id),
      'relation', case when bool_or(rel = 'customer') and bool_or(rel = 'supplier') then 'both'
        when bool_or(rel = 'customer') then 'customer' else 'supplier' end,
      'invoice_count', sum(cnt)
    ) s
    from (
      select private.normalized_ico(i.counterparty_ico) as partner_ico, 'customer' as rel, count(*) as cnt
      from invoices i where i.organization_id = target_org and i.status <> 'cancelled'
      group by 1
      union all
      select o2.ico, 'supplier', count(*)
      from invoices i join organizations o2 on o2.id = i.organization_id
      where private.normalized_ico(i.counterparty_ico) = own.ico and i.organization_id <> target_org and i.status <> 'cancelled'
        -- Jen faktury prokazatelně adresované nám (na e-mail člena nebo firmy).
        -- Samotné IČO nestačí: kdo by si v nastavení přepsal IČO na cizí,
        -- viděl by jinak, kdo té firmě fakturuje.
        and private.network_org_ready(target_org)
        and lower(i.counterparty_email) in (
          select lower(m.email) from organization_members m where m.organization_id = target_org
          union select lower(o3.email) from organizations o3 where o3.id = target_org and o3.email is not null)
      group by 1
    ) r
    join organizations o on o.ico = r.partner_ico
    where o.id <> target_org
      and private.network_org_ready(o.id)
      and not exists (select 1 from organization_connections c
        where c.org_low = least(target_org, o.id) and c.org_high = greatest(target_org, o.id) and c.status in ('pending', 'active'))
    group by o.id
    limit 20
  ) t;

  -- Odběratelé, kteří Splatno ještě nepoužívají (kandidáti na pozvánku).
  select coalesce(jsonb_agg(x order by (x->>'open_amount_czk')::numeric desc nulls last, x->>'name'), '[]'::jsonb) into invite_candidates from (
    select jsonb_build_object(
      'ico', ico_value,
      'name', (array_agg(counterparty_name order by issue_date desc))[1],
      'email', (array_agg(lower(counterparty_email) order by issue_date desc))[1],
      'invoice_count', count(*),
      'open_amount_czk', coalesce(sum(amount - paid_amount) filter (where status in ('pending', 'overdue') and currency = 'CZK'), 0),
      'invited_at', (select max(coalesce(n.sent_at, n.created_at)) from network_invitations n
        where n.inviter_org = target_org and n.invitee_ico = ico_value and n.accepted_at is null)
    ) x
    from (select private.normalized_ico(counterparty_ico) ico_value, * from invoices
          where organization_id = target_org and status <> 'cancelled') i
    where private.valid_ico(ico_value) and ico_value <> own.ico
      and not exists (select 1 from organizations o where o.ico = ico_value)
    group by ico_value
    limit 30
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'ico', n.invitee_ico, 'email', n.invitee_email, 'sent_at', n.sent_at,
      'expires_at', n.expires_at, 'expired', n.accepted_at is null and n.expires_at < now(), 'accepted_at', n.accepted_at,
      'accepted_partner', case when n.accepted_org is not null then private.network_org_card(n.accepted_org) end
    ) order by n.created_at desc), '[]'::jsonb) into invitations
  from network_invitations n where n.inviter_org = target_org and n.created_at > now() - interval '180 days';

  return jsonb_build_object(
    'me', jsonb_build_object('name', own.name, 'ico', own.ico, 'network_ready', private.network_org_ready(target_org), 'role', actor_role),
    'connections', connections,
    'suggestions', suggestions,
    'invite_candidates', invite_candidates,
    'invitations', invitations
  );
end;
$$;

create or replace function private.network_invoice_json(i public.invoices, viewer uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', i.id,
    'invoice_number', i.invoice_number,
    'variable_symbol', i.variable_symbol,
    'issue_date', i.issue_date,
    'due_date', i.due_date,
    'amount', i.amount,
    'paid_amount', i.paid_amount,
    'currency', i.currency,
    'status', private.network_invoice_state(i),
    'paid_at', i.paid_at,
    'issued_by_me', i.organization_id = viewer,
    'flags', coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.id, 'kind', f.kind, 'reason', f.reason, 'note', f.note, 'status', f.status,
        'claimed_paid_on', f.claimed_paid_on, 'claimed_amount', f.claimed_amount,
        'resolution_note', f.resolution_note, 'created_at', f.created_at, 'decided_at', f.decided_at
      ) order by f.created_at desc)
      from network_invoice_flags f where f.invoice_id = i.id and (f.status = 'open' or f.decided_at > now() - interval '30 days')), '[]'::jsonb)
  )
$$;

create or replace function network_partner(target_org uuid, actor_user uuid, target_connection uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  actor_role text;
  conn organization_connections%rowtype;
  partner_id uuid;
  partner organizations%rowtype;
begin
  actor_role := private.network_actor_role(target_org, actor_user, false);
  select * into conn from organization_connections where id = target_connection;
  if conn.id is null or target_org not in (conn.requester_org, conn.addressee_org) or conn.status <> 'active' then
    return null;
  end if;
  partner_id := case when conn.requester_org = target_org then conn.addressee_org else conn.requester_org end;
  select * into partner from organizations where id = partner_id;

  return jsonb_build_object(
    'id', conn.id,
    'role', actor_role,
    'activated_at', conn.activated_at,
    'origin', conn.origin,
    'partner', private.network_org_card(partner_id) || jsonb_build_object(
      'email', partner.email, 'phone', partner.phone,
      'bank_account_czk', partner.bank_account_czk, 'bank_account_eur', partner.bank_account_eur),
    'share_history', jsonb_build_object(
      'mine', case when conn.requester_org = target_org then conn.requester_share_history else conn.addressee_share_history end,
      'theirs', case when conn.requester_org = target_org then conn.addressee_share_history else conn.requester_share_history end),
    'balances', private.network_balance(conn.id, target_org, partner_id),
    'issued', coalesce((select jsonb_agg(private.network_invoice_json(i, target_org) order by i.due_date desc, i.invoice_number)
      from private.network_shared_invoices(conn.id, target_org) i), '[]'::jsonb),
    'received', coalesce((select jsonb_agg(private.network_invoice_json(i, target_org) order by i.due_date desc, i.invoice_number)
      from private.network_shared_invoices(conn.id, partner_id) i), '[]'::jsonb),
    -- Platební morálka za 12 měsíců: kolik dní po splatnosti se v průměru platí.
    'behaviour', jsonb_build_object(
      'they_pay', (select jsonb_build_object('paid_count', count(*),
          'avg_days_late', round(avg(greatest((i.paid_at at time zone 'Europe/Prague')::date - i.due_date, 0))::numeric, 1),
          'on_time_share', round(avg(case when (i.paid_at at time zone 'Europe/Prague')::date <= i.due_date then 1 else 0 end)::numeric, 2))
        from private.network_shared_invoices(conn.id, target_org) i where i.status = 'paid' and i.paid_at > now() - interval '12 months'
          and not private.network_initially_paid(i)),
      'we_pay', (select jsonb_build_object('paid_count', count(*),
          'avg_days_late', round(avg(greatest((i.paid_at at time zone 'Europe/Prague')::date - i.due_date, 0))::numeric, 1),
          'on_time_share', round(avg(case when (i.paid_at at time zone 'Europe/Prague')::date <= i.due_date then 1 else 0 end)::numeric, 2))
        from private.network_shared_invoices(conn.id, partner_id) i where i.status = 'paid' and i.paid_at > now() - interval '12 months'
          and not private.network_initially_paid(i))
    )
  );
end;
$$;

-- Schránka přijatých faktur: od všech aktivních partnerů.
create or replace function network_received(target_org uuid, actor_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  perform private.network_actor_role(target_org, actor_user, false);
  return coalesce((
    select jsonb_agg(private.network_invoice_json(i, target_org) || jsonb_build_object(
        'connection_id', c.id, 'partner', private.network_org_card(i.organization_id))
      order by (case when i.status in ('pending', 'overdue') then 0 else 1 end), i.due_date, i.invoice_number)
    from organization_connections c
    cross join lateral private.network_shared_invoices(c.id,
      case when c.requester_org = target_org then c.addressee_org else c.requester_org end) i
    where target_org in (c.requester_org, c.addressee_org) and c.status = 'active'
  ), '[]'::jsonb);
end;
$$;

-- Jedna přijatá faktura pro PDF / QR: whitelist sloupců a firma vystavitele.
create or replace function network_partner_invoice(target_org uuid, actor_user uuid, target_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  conn_id uuid;
  inv invoices%rowtype;
  issuer organizations%rowtype;
begin
  perform private.network_actor_role(target_org, actor_user, false);
  select * into inv from invoices where id = target_invoice;
  if inv.id is null or inv.organization_id = target_org then return null; end if;
  select c.id into conn_id from organization_connections c
  where c.org_low = least(target_org, inv.organization_id) and c.org_high = greatest(target_org, inv.organization_id)
    and c.status = 'active';
  if conn_id is null or not exists (select 1 from private.network_shared_invoices(conn_id, inv.organization_id) s where s.id = inv.id) then
    return null;
  end if;
  select * into issuer from organizations where id = inv.organization_id;
  return jsonb_build_object(
    'connection_id', conn_id,
    'invoice', jsonb_build_object(
      'id', inv.id, 'invoice_number', inv.invoice_number, 'variable_symbol', inv.variable_symbol,
      'counterparty_name', inv.counterparty_name, 'counterparty_ico', inv.counterparty_ico,
      'counterparty_dic', inv.counterparty_dic, 'counterparty_email', inv.counterparty_email,
      'amount_without_vat', inv.amount_without_vat, 'vat_rate', inv.vat_rate, 'amount', inv.amount,
      'paid_amount', inv.paid_amount, 'currency', inv.currency, 'issue_date', inv.issue_date,
      'due_date', inv.due_date, 'status', private.network_invoice_state(inv), 'paid_at', inv.paid_at),
    'issuer', jsonb_build_object(
      'name', issuer.name, 'ico', issuer.ico, 'dic', issuer.dic,
      'registered_address', issuer.registered_address, 'operating_address', issuer.operating_address,
      'phone', issuer.phone, 'email', issuer.email,
      'bank_account_czk', issuer.bank_account_czk, 'bank_account_eur', issuer.bank_account_eur)
  );
end;
$$;

-- Pro detail faktury vystavitele: vidí ji odběratel ve Splatnu? Má k ní připomínky?
create or replace function network_invoice_context(target_org uuid, actor_user uuid, target_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  inv invoices%rowtype;
  partner organizations%rowtype;
  conn_id uuid;
begin
  perform private.network_actor_role(target_org, actor_user, false);
  select * into inv from invoices where id = target_invoice and organization_id = target_org;
  if inv.id is null or private.normalized_ico(inv.counterparty_ico) is null then return null; end if;
  if (select count(*) from organizations where ico = private.normalized_ico(inv.counterparty_ico)) <> 1 then return null; end if;
  select * into partner from organizations where ico = private.normalized_ico(inv.counterparty_ico);
  if partner.id = target_org then return null; end if;
  select c.id into conn_id from organization_connections c
  where c.org_low = least(target_org, partner.id) and c.org_high = greatest(target_org, partner.id) and c.status = 'active';
  if conn_id is null then
    return jsonb_build_object('state', 'not_connected', 'partner', jsonb_build_object('name', partner.name, 'ico', partner.ico));
  end if;
  return jsonb_build_object(
    'state', case when exists (select 1 from private.network_shared_invoices(conn_id, target_org) s where s.id = inv.id)
      then 'shared' else 'not_shared' end,
    'connection_id', conn_id,
    'partner', jsonb_build_object('name', partner.name, 'ico', partner.ico),
    'flags', private.network_invoice_json(inv, target_org)->'flags'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Rozpory a oznámené platby (nikdy nemění peníze)
-- ---------------------------------------------------------------------------

create or replace function network_flag_invoice(
  target_org uuid, actor_user uuid, target_invoice uuid, flag_kind text, flag_reason text,
  flag_note text, paid_on date, paid_amount_value numeric
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  inv invoices%rowtype;
  conn_id uuid;
  flag_id uuid;
  clean_note text := nullif(trim(coalesce(flag_note, '')), '');
begin
  perform private.network_actor_role(target_org, actor_user, false);
  if flag_kind is null or flag_kind not in ('disputed', 'payment_claimed') then raise exception 'invalid_flag'; end if;
  select * into inv from invoices where id = target_invoice for update;
  if inv.id is null or inv.organization_id = target_org then raise exception 'invoice_not_found'; end if;
  select c.id into conn_id from organization_connections c
  where c.org_low = least(target_org, inv.organization_id) and c.org_high = greatest(target_org, inv.organization_id)
    and c.status = 'active';
  if conn_id is null or not exists (select 1 from private.network_shared_invoices(conn_id, inv.organization_id) s where s.id = inv.id) then
    raise exception 'invoice_not_found';
  end if;
  if inv.status not in ('pending', 'overdue') then raise exception 'invoice_closed'; end if;
  if clean_note is not null and char_length(clean_note) > 1000 then raise exception 'note_too_long'; end if;
  if flag_kind = 'disputed' then
    if flag_reason is null or flag_reason not in ('price', 'quantity', 'not_delivered', 'duplicate', 'other') then raise exception 'invalid_reason'; end if;
    if flag_reason = 'other' and clean_note is null then raise exception 'note_required'; end if;
  else
    if paid_on is null or paid_on > current_date or paid_on < inv.issue_date - 30 then raise exception 'invalid_paid_on'; end if;
    if paid_amount_value is null or paid_amount_value <= 0 or paid_amount_value > inv.amount - inv.paid_amount then raise exception 'invalid_amount'; end if;
  end if;
  if exists (select 1 from network_invoice_flags where invoice_id = inv.id and kind = flag_kind and status = 'open') then
    raise exception 'flag_exists';
  end if;
  insert into network_invoice_flags (connection_id, invoice_id, issuer_org, recipient_org, kind, reason, note,
    claimed_paid_on, claimed_amount, created_by)
  values (conn_id, inv.id, inv.organization_id, target_org, flag_kind,
    case when flag_kind = 'disputed' then flag_reason end, clean_note,
    case when flag_kind = 'payment_claimed' then paid_on end,
    case when flag_kind = 'payment_claimed' then paid_amount_value end, actor_user)
  returning id into flag_id;
  perform private.network_log(conn_id, target_org, actor_user, 'flag_created',
    jsonb_build_object('flag_id', flag_id, 'invoice_id', inv.id, 'kind', flag_kind));
  return jsonb_build_object('flag_id', flag_id, 'connection_id', conn_id);
end;
$$;

-- Vystavitel rozhodne (resolved/rejected), autor může vzít zpět (withdrawn).
create or replace function network_decide_flag(target_org uuid, actor_user uuid, target_flag uuid, decision text, decision_note text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  flag network_invoice_flags%rowtype;
  clean_note text := nullif(trim(coalesce(decision_note, '')), '');
begin
  perform private.network_actor_role(target_org, actor_user, false);
  if decision is null or decision not in ('resolved', 'rejected', 'withdrawn') then raise exception 'invalid_decision'; end if;
  if clean_note is not null and char_length(clean_note) > 1000 then raise exception 'note_too_long'; end if;
  select * into flag from network_invoice_flags where id = target_flag for update;
  if flag.id is null or target_org not in (flag.issuer_org, flag.recipient_org) then raise exception 'flag_not_found'; end if;
  if flag.status <> 'open' then raise exception 'flag_closed'; end if;
  if decision in ('resolved', 'rejected') and flag.issuer_org <> target_org then raise exception 'insufficient_permission'; end if;
  if decision = 'withdrawn' and flag.recipient_org <> target_org then raise exception 'insufficient_permission'; end if;
  if not exists (select 1 from organization_connections where id = flag.connection_id and status = 'active') then
    raise exception 'not_active';
  end if;
  update network_invoice_flags set status = decision, resolution_note = clean_note, decided_by = actor_user, decided_at = now()
  where id = flag.id;
  perform private.network_log(flag.connection_id, target_org, actor_user, 'flag_resolved',
    jsonb_build_object('flag_id', flag.id, 'decision', decision));
  return jsonb_build_object('flag_id', flag.id, 'status', decision);
end;
$$;

-- ---------------------------------------------------------------------------
-- Pozvánky firem, které Splatno ještě nepoužívají
-- ---------------------------------------------------------------------------

create or replace function network_issue_invitation(
  target_org uuid, actor_user uuid, target_ico text, target_email text, token_hash text, expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  wanted text := private.normalized_ico(target_ico);
  clean_email text := lower(trim(coalesce(target_email, '')));
  existing network_invitations%rowtype;
  invitation_id uuid;
  inviter organizations%rowtype;
begin
  perform private.require_org_admin(target_org, actor_user);
  if wanted is null or not private.valid_ico(wanted) then raise exception 'invalid_ico'; end if;
  if clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(clean_email) > 254 then raise exception 'invalid_email'; end if;
  if token_hash is null or token_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_token'; end if;
  if expires_at is null or expires_at <= now() or expires_at > now() + interval '31 days' then raise exception 'invalid_expiry'; end if;
  select * into inviter from organizations where id = target_org;
  if inviter.ico = wanted then raise exception 'self_connection'; end if;
  if exists (select 1 from organizations where ico = wanted) then raise exception 'already_on_network'; end if;
  if exists (select 1 from email_suppressions s where s.email = clean_email)
    or exists (select 1 from network_invitation_optouts o where o.email = clean_email) then
    raise exception 'email_suppressed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('network-invite:' || target_org::text || wanted, 0));
  select * into existing from network_invitations
  where inviter_org = target_org and invitee_ico = wanted and accepted_at is null for update;
  -- Jedna pozvánka + nejvýš jedna připomínka; mezi nimi aspoň 7 dní.
  if existing.id is not null then
    if existing.send_count >= 2 then raise exception 'invitation_limit'; end if;
    if existing.sent_at is not null and existing.sent_at > now() - interval '7 days' then raise exception 'recently_invited'; end if;
    update network_invitations set invitee_email = clean_email, token_hash = network_issue_invitation.token_hash,
      expires_at = network_issue_invitation.expires_at, invited_by = actor_user
    where id = existing.id returning id into invitation_id;
    insert into network_invitation_tokens (token_hash, invitation_id, email) values (network_issue_invitation.token_hash, invitation_id, clean_email);
  else
    if (select count(*) from network_invitations where inviter_org = target_org and created_at > now() - interval '1 day') >= 20 then
      raise exception 'daily_limit';
    end if;
    insert into network_invitations (inviter_org, invited_by, invitee_ico, invitee_email, token_hash, expires_at)
    values (target_org, actor_user, wanted, clean_email, network_issue_invitation.token_hash, network_issue_invitation.expires_at)
    returning id into invitation_id;
    insert into network_invitation_tokens (token_hash, invitation_id, email) values (network_issue_invitation.token_hash, invitation_id, clean_email);
  end if;
  perform private.network_log(null, target_org, actor_user, 'invitation_issued', jsonb_build_object('invitation_id', invitation_id, 'ico', wanted));

  return jsonb_build_object(
    'invitation_id', invitation_id,
    'inviter_name', inviter.name,
    'invitee_ico', wanted,
    'invitee_email', clean_email,
    'open_count', (select count(*) from invoices i where i.organization_id = target_org
      and i.status in ('pending', 'overdue') and private.normalized_ico(i.counterparty_ico) = wanted)
  );
end;
$$;

create or replace function network_mark_invitation_sent(target_invitation uuid)
returns void language sql security definer set search_path = public
as $$
  update network_invitations set sent_at = now(), send_count = send_count + 1 where id = target_invitation and accepted_at is null
$$;

-- Veřejný náhled podle tokenu (stránka /pripojeni/[token]). Jen to, co pozvaný
-- stejně ví z faktur, které od firmy dostal.
create or replace function network_invitation_preview(target_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  inv network_invitations%rowtype;
  inviter organizations%rowtype;
begin
  if target_token_hash is null or target_token_hash !~ '^[a-f0-9]{64}$' then return null; end if;
  select n.* into inv from network_invitation_tokens t join network_invitations n on n.id = t.invitation_id
  where t.token_hash = target_token_hash;
  if inv.id is null then return null; end if;
  select * into inviter from organizations where id = inv.inviter_org;
  return jsonb_build_object(
    'state', case when inv.accepted_at is not null then 'accepted' when inv.expires_at < now() then 'expired' else 'valid' end,
    'inviter', jsonb_build_object('name', inviter.name, 'ico', inviter.ico, 'logo_path', inviter.logo_path),
    'invitee_ico', inv.invitee_ico,
    'invitee_email', inv.invitee_email,
    'expires_at', inv.expires_at,
    'open_count', (select count(*) from invoices i where i.organization_id = inv.inviter_org
      and i.status in ('pending', 'overdue') and private.normalized_ico(i.counterparty_ico) = inv.invitee_ico)
  );
end;
$$;

-- Odkaz „Nepřeji si další pozvánky“ z e-mailu. Funguje i pro prošlou pozvánku.
create or replace function network_invitation_opt_out(target_token_hash text)
returns boolean language plpgsql security definer set search_path = public
as $$
declare target_email text;
begin
  if target_token_hash is null or target_token_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  select email into target_email from network_invitation_tokens where token_hash = target_token_hash;
  if target_email is null then return false; end if;
  insert into network_invitation_optouts (email) values (target_email) on conflict (email) do nothing;
  return true;
end;
$$;

-- Přijetí pozvánky přihlášeným adminem firmy. IČO musí sedět; jinak viditelná
-- chyba, nikdy tiché propojení s jinou firmou.
create or replace function network_accept_invitation(target_org uuid, actor_user uuid, target_token_hash text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  inv network_invitations%rowtype;
  own organizations%rowtype;
  conn organization_connections%rowtype;
begin
  perform private.require_org_admin(target_org, actor_user);
  if target_token_hash is null or target_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'invitation_not_found'; end if;
  select n.* into inv from network_invitation_tokens t join network_invitations n on n.id = t.invitation_id
  where t.token_hash = target_token_hash for update of n;
  if inv.id is null then raise exception 'invitation_not_found'; end if;
  if inv.accepted_at is not null then raise exception 'invitation_used'; end if;
  if inv.expires_at < now() then raise exception 'invitation_expired'; end if;
  select * into own from organizations where id = target_org;
  if inv.inviter_org = target_org then raise exception 'self_connection'; end if;
  if own.ico <> inv.invitee_ico then raise exception 'ico_mismatch'; end if;
  if not (private.network_org_ready(target_org) and private.network_org_ready(inv.inviter_org)) then raise exception 'own_ico_ambiguous'; end if;

  perform pg_advisory_xact_lock(hashtextextended('network-pair:' || least(target_org, inv.inviter_org)::text || greatest(target_org, inv.inviter_org)::text, 0));
  select * into conn from organization_connections
  where org_low = least(target_org, inv.inviter_org) and org_high = greatest(target_org, inv.inviter_org)
    and status in ('pending', 'active') for update;
  if conn.id is null then
    insert into organization_connections (requester_org, addressee_org, requester_ico, addressee_ico, status, origin, requested_by)
    values (inv.inviter_org, target_org, (select ico from organizations where id = inv.inviter_org), own.ico, 'pending', 'invitation', inv.invited_by)
    returning * into conn;
    perform private.network_activate(conn.id, actor_user);
  elsif conn.status = 'pending' then
    perform private.network_activate(conn.id, actor_user);
  end if;
  update network_invitations set accepted_org = target_org, accepted_at = now() where id = inv.id;
  -- Atribuce jen u firmy, která vznikla až po pozvánce.
  update organizations set referred_by_org = inv.inviter_org
  where id = target_org and referred_by_org is null and created_at >= inv.created_at;
  perform private.network_log(conn.id, target_org, actor_user, 'invitation_accepted', jsonb_build_object('invitation_id', inv.id));
  return jsonb_build_object('connection_id', conn.id, 'status', 'active');
end;
$$;

-- ---------------------------------------------------------------------------
-- Změna IČO firmy ukončí její propojení. Propojení platí pro firmu s IČO
-- z okamžiku propojení; s jiným IČO je to jiná firma, a ta se musí propojit
-- znovu (a partner ji znovu přijmout).
-- ---------------------------------------------------------------------------
create or replace function private.network_revoke_on_ico_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare conn record;
begin
  if new.ico is not distinct from old.ico then return new; end if;
  for conn in
    update organization_connections set status = 'revoked', revoked_by_org = new.id, revoked_at = now()
    where new.id in (requester_org, addressee_org) and status in ('pending', 'active')
    returning id
  loop
    update network_invoice_flags set status = 'withdrawn', decided_at = now(),
      resolution_note = 'Propojení skončilo změnou IČO firmy.'
    where connection_id = conn.id and status = 'open';
    insert into organization_connection_events (connection_id, organization_id, event_type, details)
    values (conn.id, new.id, 'revoked', jsonb_build_object('reason', 'ico_changed', 'old_ico', old.ico, 'new_ico', new.ico));
  end loop;
  return new;
end;
$$;
drop trigger if exists organizations_network_ico_change on public.organizations;
create trigger organizations_network_ico_change after update of ico on public.organizations
for each row execute function private.network_revoke_on_ico_change();

-- ---------------------------------------------------------------------------
-- Práva: vše jen pro service_role (API route s ověřenou identitou).
-- ---------------------------------------------------------------------------
do $$
declare signature text;
begin
  foreach signature in array array[
    'private.normalized_ico(text)',
    'private.network_org_ready(uuid)',
    'private.network_actor_role(uuid, uuid, boolean)',
    'private.network_shared_invoices(uuid, uuid)',
    'private.network_initially_paid(public.invoices)',
    'private.network_activate(uuid, uuid)',
    'private.network_revoke_on_ico_change()',
    'private.network_invoice_state(public.invoices)',
    'private.network_balance(uuid, uuid, uuid)',
    'private.network_org_card(uuid)',
    'private.network_log(uuid, uuid, uuid, text, jsonb)',
    'private.network_invoice_json(public.invoices, uuid)',
    'public.network_lookup(uuid, uuid, text)',
    'public.network_request(uuid, uuid, text, text, text)',
    'public.network_respond(uuid, uuid, uuid, boolean)',
    'public.network_revoke(uuid, uuid, uuid)',
    'public.network_set_share_history(uuid, uuid, uuid, boolean)',
    'public.network_overview(uuid, uuid)',
    'public.network_partner(uuid, uuid, uuid)',
    'public.network_received(uuid, uuid)',
    'public.network_partner_invoice(uuid, uuid, uuid)',
    'public.network_invoice_context(uuid, uuid, uuid)',
    'public.network_flag_invoice(uuid, uuid, uuid, text, text, text, date, numeric)',
    'public.network_decide_flag(uuid, uuid, uuid, text, text)',
    'public.network_issue_invitation(uuid, uuid, text, text, text, timestamptz)',
    'public.network_mark_invitation_sent(uuid)',
    'public.network_invitation_preview(text)',
    'public.network_invitation_opt_out(text)',
    'public.network_accept_invitation(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', signature);
    execute format('grant execute on function %s to service_role', signature);
  end loop;
end $$;
