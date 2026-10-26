-- Durable manual-send actions. Browser roles cannot reserve or acknowledge mail.
create table public.invoice_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  action_key text not null check (length(action_key) between 1 and 120),
  request_hash text not null check (length(request_hash)=64),
  recipient text not null,
  purpose text not null check (purpose in ('issue','manual')),
  status text not null default 'sending' check (status in ('sending','failed','accepted')),
  lease_token uuid not null default gen_random_uuid(),
  claimed_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  provider_id text,
  payload jsonb,
  unique(organization_id,invoice_id,action_key)
);
create index invoice_email_deliveries_latest on public.invoice_email_deliveries(organization_id,invoice_id,created_at desc);
alter table public.invoice_email_deliveries enable row level security;
revoke all on public.invoice_email_deliveries from public,anon,authenticated;
grant all on public.invoice_email_deliveries to service_role;

-- Retries from a refreshed client can adopt an unresolved action; retain
-- that alias so repeating the new key also replays the same accepted mail.
create table public.invoice_email_action_keys (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  action_key text not null,
  delivery_id uuid not null references public.invoice_email_deliveries(id) on delete cascade,
  primary key(organization_id,invoice_id,action_key)
);
alter table public.invoice_email_action_keys enable row level security;
revoke all on public.invoice_email_action_keys from public,anon,authenticated;
grant all on public.invoice_email_action_keys to service_role;

create function public.claim_invoice_email(target_org uuid, actor_user uuid, target_invoice uuid,
  send_purpose text, action_id text, payload_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare inv public.invoices%rowtype; delivery public.invoice_email_deliveries%rowtype;
  latest public.invoice_email_deliveries%rowtype; key text; recipient_email text;
begin
  if not exists(select 1 from public.organization_members where organization_id=target_org and user_id=actor_user
    and role in ('admin','accounting') and (support_expires_at is null or support_expires_at>now()))
    then raise exception 'email_access_denied' using errcode='42501'; end if;
  if send_purpose not in ('issue','manual') or payload_hash !~ '^[a-f0-9]{64}$'
    or (action_id is not null and action_id !~ '^[a-zA-Z0-9_-]{1,100}$')
    then raise exception 'invalid_email_action' using errcode='22023'; end if;
  -- Every action for the same invoice serializes here, including legacy callers
  -- without an action ID and concurrent requests with different action IDs.
  select * into inv from public.invoices where id=target_invoice and organization_id=target_org for update;
  if not found then raise exception 'invoice_not_found'; end if;
  recipient_email:=lower(trim(inv.counterparty_email));
  if recipient_email='' then return jsonb_build_object('state','invalid_recipient'); end if;
  if exists(select 1 from public.email_suppressions where organization_id=target_org and email=recipient_email)
    then return jsonb_build_object('state','suppressed'); end if;
  key:=case when send_purpose='issue' then 'issue' else action_id end;
  if key is not null then
    select * into delivery from public.invoice_email_deliveries
      where organization_id=target_org and invoice_id=target_invoice and action_key=key;
    if delivery.id is null then
      select d.* into delivery from public.invoice_email_deliveries d
      join public.invoice_email_action_keys a on a.delivery_id=d.id
      where a.organization_id=target_org and a.invoice_id=target_invoice and a.action_key=key
        and d.organization_id=target_org and d.invoice_id=target_invoice;
    end if;
  end if;
  if delivery.id is null then
    select * into latest from public.invoice_email_deliveries
      where organization_id=target_org and invoice_id=target_invoice order by created_at desc limit 1;
    -- An unresolved provider request must retain its key, even after refresh.
    if latest.status in ('sending','failed') or (action_id is null and latest.purpose=send_purpose
      and latest.created_at>clock_timestamp()-interval '60 seconds') then delivery:=latest; end if;
  end if;
  if delivery.id is not null then
    if delivery.request_hash<>payload_hash or delivery.recipient<>recipient_email or delivery.purpose<>send_purpose
      then return jsonb_build_object('state','conflict'); end if;
    if key is not null and key<>delivery.action_key then
      insert into public.invoice_email_action_keys(organization_id,invoice_id,action_key,delivery_id)
        values(target_org,target_invoice,key,delivery.id) on conflict do nothing;
    end if;
    if delivery.status='accepted' then return jsonb_build_object('state','accepted','id',delivery.id); end if;
    -- Resend retains idempotency keys for 24h. Never silently replay an
    -- ambiguous result after that window and risk delivering another message.
    if delivery.created_at<clock_timestamp()-interval '23 hours'
      then return jsonb_build_object('state','expired'); end if;
    if delivery.status='sending' and delivery.claimed_at>clock_timestamp()-interval '5 minutes'
      then return jsonb_build_object('state','busy'); end if;
    update public.invoice_email_deliveries set status='sending',lease_token=gen_random_uuid(),claimed_at=clock_timestamp()
      where id=delivery.id returning * into delivery;
  else
    insert into public.invoice_email_deliveries(organization_id,invoice_id,action_key,request_hash,recipient,purpose)
      values(target_org,target_invoice,coalesce(key,gen_random_uuid()::text),payload_hash,recipient_email,send_purpose)
      returning * into delivery;
  end if;
  return jsonb_build_object('state','claimed','id',delivery.id,'lease_token',delivery.lease_token);
end $$;

create function public.finish_invoice_email(target_org uuid, delivery_id uuid, claim_token uuid, accepted_provider_id text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  update public.invoice_email_deliveries set
    status=case when accepted_provider_id is null then 'failed' else 'accepted' end,
    payload=case when accepted_provider_id is null then payload else null end,
    provider_id=accepted_provider_id
    where organization_id=target_org and id=delivery_id and lease_token=claim_token and status='sending';
  get diagnostics changed=row_count;
  return changed=1;
end $$;
revoke all on function public.claim_invoice_email(uuid,uuid,uuid,text,text,text),public.finish_invoice_email(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_invoice_email(uuid,uuid,uuid,text,text,text),public.finish_invoice_email(uuid,uuid,uuid,text) to service_role;

-- Freeze the exact provider request (PDF bytes included). Regenerating a PDF
-- or crossing midnight must not change the payload behind an idempotency key.
create function public.stage_invoice_email(target_org uuid, delivery_id uuid, claim_token uuid, email_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare frozen jsonb;
begin
  update public.invoice_email_deliveries set payload=coalesce(payload,email_payload)
    where organization_id=target_org and id=delivery_id and lease_token=claim_token and status='sending'
    returning payload into frozen;
  if frozen is null then raise exception 'email_claim_lost'; end if;
  return frozen;
end $$;
revoke all on function public.stage_invoice_email(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.stage_invoice_email(uuid,uuid,uuid,jsonb) to service_role;
