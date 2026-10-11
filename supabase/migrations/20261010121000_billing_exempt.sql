-- Trvalý přístup bez platby jako výslovný příznak (subscriptions.billing_exempt).
--
-- Dosud se „trvale zdarma“ (R. Hlavica a firmy z doby před předplatným)
-- poznalo jen nepřímo: status 'active' a žádné Stripe ID. Admin takové
-- firmy ale mohl projít Stripe Checkoutem: link_stripe_customer uložil
-- zákazníka, nepřímá podmínka v sync_stripe_subscription přestala platit a
-- zrcadlení ze Stripe trvalé předplatné tiše přepsalo na placené.
--
-- * billing_exempt: backfill pro dosavadní nepřímo poznané řádky; mění ho
--   jen migrace / service_role.
-- * link_stripe_customer a sync_stripe_subscription exempt firmu odmítnou.
-- * enforce_invoice_subscription: firma bez řádku předplatného už nefakturuje
--   zdarma (každá firma řádek má: onboarding nebo ensure_legacy_subscriptions).
--
-- Aktuální těla všech tří funkcí jsou v 20261009120000_stripe_subscriptions.sql
-- (ensure_legacy_subscriptions v 20261007125359_billing_and_verification.sql);
-- signatury a GRANTy zůstávají.

alter table public.subscriptions
  add column if not exists billing_exempt boolean not null default false;

update public.subscriptions set billing_exempt = true
where status = 'active' and stripe_customer_id is null and stripe_subscription_id is null;

revoke update (billing_exempt) on public.subscriptions from anon, authenticated;

create or replace function link_stripe_customer(target_org uuid, customer_id text)
returns void language plpgsql security definer set search_path = public
as $$
declare existing text;
begin
  if customer_id is null or customer_id !~ '^cus_[A-Za-z0-9]+$' then raise exception 'invalid_customer'; end if;
  select stripe_customer_id into existing from subscriptions where organization_id = target_org for update;
  if not found then raise exception 'subscription_not_found'; end if;
  if exists (select 1 from subscriptions where organization_id = target_org and billing_exempt) then
    raise exception 'billing_exempt';
  end if;
  if existing is not null and existing <> customer_id then raise exception 'customer_mismatch'; end if;
  update subscriptions set stripe_customer_id = customer_id, updated_at = now() where organization_id = target_org;
end;
$$;

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
  -- Trvalý přístup bez platby (R. Hlavica) Stripe nikdy nepřepíše; dřívější
  -- odvození ze stavu zůstává jako druhá pojistka.
  if row_value.billing_exempt
     or (row_value.stripe_customer_id is null and row_value.status = 'active' and row_value.stripe_subscription_id is null) then
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

create or replace function private.enforce_invoice_subscription()
returns trigger language plpgsql security definer set search_path = public
as $$
declare row_value subscriptions%rowtype;
begin
  select * into row_value from subscriptions where organization_id = new.organization_id for update;
  -- Firma bez řádku předplatného dřív fakturovala zdarma navždy.
  if not found then raise exception 'subscription_payment_required'; end if;
  if row_value.billing_exempt then return new; end if;
  if row_value.status in ('incomplete', 'incomplete_expired') then raise exception 'subscription_payment_required'; end if;
  if row_value.status in ('canceled', 'unpaid', 'paused') then raise exception 'subscription_expired'; end if;
  if row_value.status = 'trialing' then
    if row_value.trial_invoices_used >= row_value.trial_invoice_limit then raise exception 'trial_invoice_limit'; end if;
    update subscriptions set trial_invoices_used = trial_invoices_used + 1 where organization_id = new.organization_id;
  end if;
  return new;
end;
$$;

create or replace function ensure_legacy_subscriptions()
returns integer language plpgsql security definer set search_path = public
as $$
declare inserted integer;
begin
  insert into subscriptions (organization_id, status, plan, period, current_period_end, billing_exempt)
  select o.id, 'active', 'business', 'yearly', null, true
  from organizations o
  where not exists (select 1 from subscriptions s where s.organization_id = o.id)
    and o.created_by is null;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;
