-- Server-managed integration credentials. Raw API keys never enter the database.
create table public.organization_api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  key_prefix text not null check (key_prefix ~ '^[A-Za-z0-9_-]{8}$'),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null check (cardinality(scopes) > 0 and scopes <@ array[
    'invoices:read','invoices:write','invoices:send','customers:read','customers:write',
    'payments:read','payments:write','reminders:read','reminders:write','reports:read',
    'company:read','events:read'
  ]::text[]),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  request_limit integer not null default 120 check (request_limit between 1 and 1000),
  rate_window_started_at timestamptz not null default clock_timestamp(),
  rate_window_count integer not null default 0 check (rate_window_count >= 0),
  unique (organization_id,id)
);
create index organization_api_keys_org_created on public.organization_api_keys(organization_id,created_at desc);
create index organization_api_keys_creator on public.organization_api_keys(created_by);

create table public.organization_api_key_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  key_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  action text not null check (action in ('created','revoked')),
  created_at timestamptz not null default now(),
  foreign key (organization_id,key_id) references public.organization_api_keys(organization_id,id) on delete cascade
);
create index organization_api_key_events_key_time on public.organization_api_key_events(key_id,created_at desc);
create index organization_api_key_events_actor on public.organization_api_key_events(actor_user_id);
create index organization_api_key_events_org on public.organization_api_key_events(organization_id,created_at desc);

create table public.api_key_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  key_id uuid not null,
  request_id text not null check (length(request_id) between 1 and 128),
  method text not null check (method in ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS')),
  path text not null check (path like '/api/v1/%' and length(path) <= 200 and position('?' in path)=0),
  status integer not null check (status between 100 and 599),
  duration_ms integer not null check (duration_ms >= 0),
  created_at timestamptz not null default now(),
  foreign key (organization_id,key_id) references public.organization_api_keys(organization_id,id) on delete cascade
);
create index api_key_requests_org_time on public.api_key_requests(organization_id,created_at desc);
create index api_key_requests_key_time on public.api_key_requests(key_id,created_at desc);
create index api_key_requests_created on public.api_key_requests(created_at);

create table public.invoice_number_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_year integer not null check (invoice_year between 2000 and 9999),
  last_number bigint not null check (last_number between 0 and 999999999),
  primary key (organization_id,invoice_year)
);

alter table public.organization_api_keys enable row level security;
alter table public.organization_api_key_events enable row level security;
alter table public.api_key_requests enable row level security;
alter table public.invoice_number_sequences enable row level security;
revoke all on public.organization_api_keys,public.organization_api_key_events,public.api_key_requests,public.invoice_number_sequences from public,anon,authenticated;
revoke all on public.organization_api_key_events,public.api_key_requests from service_role;
grant all on public.organization_api_keys,public.invoice_number_sequences to service_role;
grant select,insert on public.organization_api_key_events,public.api_key_requests to service_role;
grant usage,select on sequence public.organization_api_key_events_id_seq to service_role;

create function public.create_organization_api_key(
  target_org uuid,actor_user uuid,key_name text,display_prefix text,secret_hash text,
  granted_scopes text[],expiration_time timestamptz default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  saved public.organization_api_keys;
begin
  perform 1 from public.organization_members m where m.organization_id=target_org
    and m.user_id=actor_user and m.role='admin' and m.support_expires_at is null for share;
  if not found then raise insufficient_privilege using message='api_key_admin_required'; end if;
  if expiration_time is not null and expiration_time<=clock_timestamp() then
    raise invalid_parameter_value using message='invalid_api_key_expiration';
  end if;
  insert into public.organization_api_keys(organization_id,name,key_prefix,key_hash,scopes,created_by,expires_at)
    values(target_org,btrim(key_name),display_prefix,secret_hash,granted_scopes,actor_user,expiration_time) returning * into saved;
  insert into public.organization_api_key_events(organization_id,key_id,actor_user_id,action)
    values(target_org,saved.id,actor_user,'created');
  return jsonb_build_object('id',saved.id,'name',saved.name,'key_prefix',saved.key_prefix,'scopes',saved.scopes,
    'created_at',saved.created_at,'last_used_at',saved.last_used_at,'expires_at',saved.expires_at,'revoked_at',saved.revoked_at);
end $$;

create function public.revoke_organization_api_key(target_org uuid,actor_user uuid,target_key uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare previous_revocation timestamptz;
begin
  perform 1 from public.organization_members m where m.organization_id=target_org
    and m.user_id=actor_user and m.role='admin' and m.support_expires_at is null for share;
  if not found then raise insufficient_privilege using message='api_key_admin_required'; end if;
  select k.revoked_at into previous_revocation from public.organization_api_keys k
    where k.id=target_key and k.organization_id=target_org for update;
  if not found then raise no_data_found using message='api_key_not_found'; end if;
  if previous_revocation is null then
    update public.organization_api_keys set revoked_at=clock_timestamp() where id=target_key;
    insert into public.organization_api_key_events(organization_id,key_id,actor_user_id,action)
      values(target_org,target_key,actor_user,'revoked');
  end if;
  return true;
end $$;

-- The row lock serializes authentication with revocation and rate consumption.
create function public.authenticate_organization_api_key(target_hash text,required_scope text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  credential public.organization_api_keys;
  member_id uuid; member_email text; observed_at timestamptz:=clock_timestamp();
  reset_time timestamptz; consumed integer;
begin
  if target_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('status','invalid'); end if;
  select * into credential from public.organization_api_keys where key_hash=target_hash for update;
  observed_at:=clock_timestamp();
  if not found or credential.revoked_at is not null or (credential.expires_at is not null and credential.expires_at<=observed_at) then
    return jsonb_build_object('status','invalid');
  end if;
  select m.id,m.email into member_id,member_email from public.organization_members m
    where m.organization_id=credential.organization_id and m.user_id=credential.created_by
      and m.role='admin' and m.support_expires_at is null for share;
  if not found then return jsonb_build_object('status','invalid'); end if;
  if required_scope is null or not (required_scope=any(credential.scopes)) then
    return jsonb_build_object('status','forbidden');
  end if;
  if observed_at>=credential.rate_window_started_at+interval '60 seconds' then
    credential.rate_window_started_at:=observed_at;
    credential.rate_window_count:=0;
  end if;
  reset_time:=credential.rate_window_started_at+interval '60 seconds';
  if credential.rate_window_count>=credential.request_limit then
    return jsonb_build_object('status','rate_limited','retry_after',greatest(1,ceil(extract(epoch from reset_time-observed_at))::integer));
  end if;
  consumed:=credential.rate_window_count+1;
  update public.organization_api_keys set rate_window_started_at=credential.rate_window_started_at,
    rate_window_count=consumed,last_used_at=observed_at where id=credential.id;
  return jsonb_build_object('status','ok','key_id',credential.id,'organization_id',credential.organization_id,
    'acting_user_id',credential.created_by,'membership_id',member_id,'email',member_email,'scopes',credential.scopes,
    'limit',credential.request_limit,'remaining',credential.request_limit-consumed,'reset_at',reset_time);
end $$;

-- A committed reservation is unique per organization/year, including simultaneous requests.
-- Gaps caused by a later failed invoice insert remain reserved and are never reused.
create function public.reserve_invoice_number(target_org uuid,actor_user uuid,invoice_year integer)
returns text language plpgsql security invoker set search_path='' as $$
declare
  prefix text; existing_max bigint; reserved bigint;
begin
  if invoice_year is null or invoice_year<2000 or invoice_year>9999 then raise invalid_parameter_value using message='invalid_invoice_year'; end if;
  perform 1 from public.organization_members m where m.organization_id=target_org and m.user_id=actor_user
    and m.role in ('admin','accounting') and (m.support_expires_at is null or m.support_expires_at>clock_timestamp()) for share;
  if not found then raise insufficient_privilege using message='invoice_actor_forbidden'; end if;
  prefix:='FV-'||invoice_year::text||'-';
  insert into public.invoice_number_sequences(organization_id,invoice_year,last_number) values(target_org,invoice_year,0)
    on conflict on constraint invoice_number_sequences_pkey do nothing;
  perform 1 from public.invoice_number_sequences s where s.organization_id=target_org and s.invoice_year=reserve_invoice_number.invoice_year for update;
  select coalesce(max(substring(i.invoice_number from length(prefix)+1)::bigint),0) into existing_max
    from public.invoices i where i.organization_id=target_org and i.invoice_number ~ ('^'||prefix||'[0-9]{1,9}$');
  update public.invoice_number_sequences s set last_number=greatest(s.last_number,existing_max)+1
    where s.organization_id=target_org and s.invoice_year=reserve_invoice_number.invoice_year returning s.last_number into reserved;
  return prefix||lpad(reserved::text,greatest(6,length(reserved::text)),'0');
end $$;

revoke all on function public.create_organization_api_key(uuid,uuid,text,text,text,text[],timestamptz) from public,anon,authenticated;
revoke all on function public.revoke_organization_api_key(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.authenticate_organization_api_key(text,text) from public,anon,authenticated;
revoke all on function public.reserve_invoice_number(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.create_organization_api_key(uuid,uuid,text,text,text,text[],timestamptz) to service_role;
grant execute on function public.revoke_organization_api_key(uuid,uuid,uuid) to service_role;
grant execute on function public.authenticate_organization_api_key(text,text) to service_role;
grant execute on function public.reserve_invoice_number(uuid,uuid,integer) to service_role;
