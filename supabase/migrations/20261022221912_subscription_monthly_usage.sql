-- See docs/redesign/screens/subscription/audit.md before deployment.
-- Calendar-month UTC usage, counted on insertion; deletion does not refund it.
alter table public.subscriptions
  add column if not exists invoice_month_start timestamptz,
  add column if not exists invoice_month_used integer not null default 0
    check (invoice_month_used >= 0);

update public.subscriptions s set
  invoice_month_start = date_trunc('month', now() at time zone 'UTC') at time zone 'UTC',
  invoice_month_used = (select count(*) from public.invoices i where i.organization_id=s.organization_id
    and i.created_at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'));

revoke update (invoice_month_start, invoice_month_used) on public.subscriptions from anon, authenticated;

create or replace function private.enforce_invoice_subscription()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  row_value subscriptions%rowtype;
  month_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  used integer;
  monthly_limit integer;
begin
  select * into row_value from subscriptions where organization_id = new.organization_id for update;
  if not found then raise exception 'subscription_payment_required'; end if;
  if not row_value.billing_exempt then
    if row_value.status in ('incomplete', 'incomplete_expired') then raise exception 'subscription_payment_required'; end if;
    if row_value.status in ('canceled', 'unpaid', 'paused') then raise exception 'subscription_expired'; end if;
    if row_value.status = 'trialing' then
      if row_value.trial_invoices_used >= row_value.trial_invoice_limit then raise exception 'trial_invoice_limit'; end if;
      update subscriptions set trial_invoices_used = trial_invoices_used + 1 where organization_id = new.organization_id;
    end if;
  end if;
  used := case when row_value.invoice_month_start = month_start then row_value.invoice_month_used else 0 end;
  -- Values mirror PLANS.monthlyInvoiceLimit; checked by the local SQL harness.
  monthly_limit := case row_value.plan when 'start' then 100 when 'profi' then 500 else null end;
  if not row_value.billing_exempt and row_value.status <> 'trialing'
    and monthly_limit is not null and used >= monthly_limit then
    raise exception 'monthly_invoice_limit';
  end if;
  update subscriptions set invoice_month_start=month_start, invoice_month_used=used+1 where organization_id=new.organization_id;
  return new;
end;
$$;
revoke all on function private.enforce_invoice_subscription() from public, anon, authenticated;
