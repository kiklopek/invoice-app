-- Prevent two full payments from being attached to the same invoice and make
-- correction of a mistaken bank match atomic with reopening the invoice.
alter table bank_payments add column if not exists unmatched_at timestamptz;
alter table bank_payments add column if not exists unmatched_by uuid references auth.users(id) on delete set null;

alter table bank_payments drop constraint if exists bank_payments_match_consistency;
alter table bank_payments add constraint bank_payments_match_consistency check (
  (match_status = 'matched' and invoice_id is not null and matched_at is not null)
  or (match_status <> 'matched' and invoice_id is null)
) not valid;
alter table bank_payments validate constraint bank_payments_match_consistency;

create unique index if not exists bank_payments_one_match_per_invoice
  on bank_payments (invoice_id) where invoice_id is not null and match_status = 'matched';

create or replace function assign_bank_payment(
  target_org uuid, target_payment uuid, target_invoice uuid, actor_user uuid
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare selected_payment bank_payments%rowtype; selected_invoice invoices%rowtype;
begin
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user and role in ('accounting', 'admin')) then
    raise exception 'insufficient payment assignment permission';
  end if;
  select * into selected_payment from bank_payments
  where id = target_payment and organization_id = target_org and match_status in ('unmatched', 'ambiguous') for update;
  if not found then raise exception 'payment is not available for assignment'; end if;
  select * into selected_invoice from invoices
  where id = target_invoice and organization_id = target_org and status in ('pending', 'overdue') for update;
  if not found then raise exception 'invoice is not available for assignment'; end if;
  if selected_payment.amount <> selected_invoice.amount or selected_payment.currency <> selected_invoice.currency then
    raise exception 'payment amount or currency does not match invoice';
  end if;
  update bank_payments set invoice_id = selected_invoice.id, match_status = 'matched', matched_at = now(), unmatched_at = null, unmatched_by = null
  where id = selected_payment.id;
  update invoices set status = 'paid', paid_at = (selected_payment.booked_on + time '12:00') at time zone 'Europe/Prague',
    next_reminder_at = null, updated_by = actor_user, updated_at = now() where id = selected_invoice.id;
  return jsonb_build_object('payment_id', selected_payment.id, 'invoice_id', selected_invoice.id,
    'invoice_number', selected_invoice.invoice_number, 'status', 'matched');
end;
$$;

create or replace function reopen_paid_invoice(
  target_org uuid, target_invoice uuid, actor_user uuid, new_status text, next_time timestamptz
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare selected_invoice invoices%rowtype; reopened_invoice invoices%rowtype; detached_count integer := 0;
begin
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user and role in ('accounting', 'admin')) then
    raise exception 'insufficient_permission';
  end if;
  if new_status not in ('pending', 'overdue') then raise exception 'invalid_reopen_status'; end if;
  select * into selected_invoice from invoices where id = target_invoice and organization_id = target_org for update;
  if not found then raise exception 'invoice_not_found'; end if;
  if selected_invoice.status <> 'paid' then raise exception 'invoice_not_paid'; end if;

  update bank_payments set invoice_id = null, match_status = 'unmatched', matched_at = null,
    unmatched_at = now(), unmatched_by = actor_user
  where organization_id = target_org and invoice_id = target_invoice and match_status = 'matched';
  get diagnostics detached_count = row_count;

  update invoices set status = new_status, paid_at = null, next_reminder_at = next_time,
    updated_by = actor_user, updated_at = now()
  where id = target_invoice and organization_id = target_org returning * into reopened_invoice;

  update reminder_log set status = 'failed',
    error_message = 'Faktura byla znovu otevřena; krok čeká na nové vyhodnocení.', updated_at = now()
  where invoice_id = target_invoice and status = 'skipped' and sent_at is null;

  update invoice_events set details = details || jsonb_build_object(
    'paid_at', selected_invoice.paid_at, 'detached_payments', detached_count
  ) where id = (
    select id from invoice_events where invoice_id = target_invoice and event_type = 'reopened'
    order by created_at desc limit 1
  );

  return jsonb_build_object('invoice', to_jsonb(reopened_invoice), 'detached_payments', detached_count);
end;
$$;

revoke all on function assign_bank_payment(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function assign_bank_payment(uuid, uuid, uuid, uuid) to service_role;
revoke all on function reopen_paid_invoice(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function reopen_paid_invoice(uuid, uuid, uuid, text, timestamptz) to service_role;
