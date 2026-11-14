-- Keep the creation request separate from the mutable customer contact.
-- A later contact edit must not change the replay semantics of POST /v1/customers.
create table public.api_customer_requests (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_uuid uuid not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  customer_id uuid not null references public.customers(id) deferrable initially deferred,
  created_at timestamptz not null default now(),
  primary key (organization_id, request_uuid)
);
create index api_customer_requests_customer_idx on public.api_customer_requests(customer_id);
alter table public.api_customer_requests enable row level security;
revoke all on public.api_customer_requests from public, anon, authenticated, service_role;
grant select, insert on public.api_customer_requests to service_role;
-- Explicit privileges also make replay independent of platform default grants.
-- UPDATE is required by PostgreSQL for the membership row's FOR SHARE lock.
grant select, update on public.organization_members to service_role;
grant select on public.organizations to service_role;

create function public.create_api_customer(
  target_org uuid, actor_user uuid, request_uuid uuid, payload_hash text, customer_payload jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  existing_request public.api_customer_requests%rowtype;
  customer_row public.customers%rowtype;
  replayed boolean := false;
  customer_name text := trim(customer_payload->>'name');
  customer_address text := trim(customer_payload->>'address');
  customer_email text := nullif(lower(trim(customer_payload->>'email')), '');
  customer_ico text := nullif(trim(customer_payload->>'ico'), '');
  customer_dic text := nullif(trim(customer_payload->>'dic'), '');
begin
  -- Lock the actor membership for the transaction: a concurrent downgrade may
  -- not race the write after the public API's initial key verification.
  perform 1 from public.organization_members m
  where m.organization_id=target_org and m.user_id=actor_user
    and m.role='admin' and m.support_expires_at is null
  for share;
  if not found then raise exception 'API_ACTOR_FORBIDDEN' using errcode='42501'; end if;

  if request_uuid is null or payload_hash is null or payload_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(customer_payload) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(customer_payload) k where k not in ('name','address','email','ico','dic'))
    or customer_name is null or length(customer_name) not between 1 and 200
    or customer_address is null or length(customer_address) not between 1 and 500
    or length(coalesce(customer_email,''))>254 or length(coalesce(customer_dic,''))>24
    or (customer_ico is not null and customer_ico !~ '^[0-9]{8}$')
    or (customer_email is not null and customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
  then raise exception 'API_CUSTOMER_INVALID' using errcode='22023'; end if;
  if customer_ico is not null and exists(select 1 from public.organizations o where o.id=target_org and o.ico=customer_ico)
  then raise exception 'API_CUSTOMER_IS_ISSUER' using errcode='22023'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_org::text||':'||request_uuid::text,0));
  select r.* into existing_request from public.api_customer_requests r
  where r.organization_id=target_org and r.request_uuid=create_api_customer.request_uuid;
  if found then
    if existing_request.payload_hash<>payload_hash then raise exception 'API_IDEMPOTENCY_CONFLICT'; end if;
    select c.* into strict customer_row from public.customers c
      where c.id=existing_request.customer_id and c.organization_id=target_org;
    replayed := true;
  else
    insert into public.customers(organization_id,created_by,updated_by,name,address,email,ico,dic)
    values(target_org,actor_user,actor_user,customer_name,customer_address,customer_email,customer_ico,customer_dic)
    returning * into customer_row;
    insert into public.api_customer_requests(organization_id,request_uuid,payload_hash,customer_id)
    values(target_org,request_uuid,payload_hash,customer_row.id);
  end if;
  return jsonb_build_object('replayed',replayed,'customer',jsonb_build_object(
    'id',customer_row.id,'name',customer_row.name,'ico',customer_row.ico,'dic',customer_row.dic,
    'email',customer_row.email,'address',customer_row.address,'phone',customer_row.phone,
    'created_at',customer_row.created_at,'updated_at',customer_row.updated_at
  ));
end;
$$;
revoke all on function public.create_api_customer(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_api_customer(uuid,uuid,uuid,text,jsonb) to service_role;

-- Latest previous definition: 20260919124500_customer_registry_no_duplicates.sql.
-- Explicit API-created contacts are durable, not OCR/import residue. Preserve
-- ordinary orphan cleanup and avoid breaking invoice corrections/deletions.
create or replace function private.customer_is_disposable(target_customer uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    where c.id=target_customer and coalesce(c.phone,'')='' and coalesce(c.notes,'')=''
      and not exists(select 1 from public.invoices i where i.customer_id=c.id)
      and not exists(select 1 from public.api_customer_requests r where r.customer_id=c.id)
  );
$$;
