-- Dashboard today shows totals ("kolik dlužno") but nothing that tells a
-- person what to actually DO right now. This adds three counts, additive
-- keys on the same jsonb result -- no existing key changes shape or meaning,
-- so an older frontend build against this RPC keeps working unchanged.
create or replace function dashboard_summary(target_org uuid, actor_user uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user) then raise exception 'insufficient_permission'; end if;
  with currency_totals as (
    select currency, coalesce(sum(amount - paid_amount) filter (where status in ('pending', 'overdue')), 0) as open_amount,
      coalesce(sum(amount - paid_amount) filter (where status = 'overdue'), 0) as overdue_amount,
      coalesce(sum(paid_amount) filter (where status <> 'cancelled'), 0) as paid_amount
    from invoices where organization_id = target_org group by currency
  ), recent as (
    select id, invoice_number, variable_symbol, counterparty_name, counterparty_email, amount, paid_amount, currency, due_date, status, reminders_sent, created_at
    from invoices where organization_id = target_org order by created_at desc, id desc limit 5
  ), upcoming as (
    select id, invoice_number, counterparty_name, amount, paid_amount, currency, status, next_reminder_at
    from invoices where organization_id = target_org and status in ('pending', 'overdue') and next_reminder_at is not null
    order by next_reminder_at, id limit 4
  )
  select jsonb_build_object(
    'open_totals', coalesce((select jsonb_object_agg(currency, open_amount) from currency_totals where open_amount > 0), '{}'::jsonb),
    'overdue_totals', coalesce((select jsonb_object_agg(currency, overdue_amount) from currency_totals where overdue_amount > 0), '{}'::jsonb),
    'paid_totals', coalesce((select jsonb_object_agg(currency, paid_amount) from currency_totals where paid_amount > 0), '{}'::jsonb),
    'active_count', (select count(*) from invoices where organization_id = target_org and status in ('pending', 'overdue')),
    'overdue_count', (select count(*) from invoices where organization_id = target_org and status = 'overdue'),
    'reminders_sent', coalesce((select sum(reminders_sent) from invoices where organization_id = target_org), 0),
    'recent', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc) from recent r), '[]'::jsonb),
    'upcoming', coalesce((select jsonb_agg(to_jsonb(u) order by u.next_reminder_at, u.id) from upcoming u), '[]'::jsonb),
    -- Same definition payment_reconciliation_summary uses for its
    -- needs_review total (see 20260917020000), just without a date filter --
    -- this is "how many right now", not "how many in this reporting period".
    -- bank_payment_id is NOT the signal: the automatic pass books a
    -- bank_payments row for every accepted entry regardless of outcome
    -- (matched, split, ambiguous or unmatched), so a row can carry a
    -- bank_payment_id and still be exactly the kind of low-confidence
    -- match a person needs to look at.
    'payments_needing_review', (
      select count(*) from bank_statement_entries
      where organization_id = target_org and disposition = 'accepted'
        and (proposal_confidence = 'review' or proposal_confidence is null)
    ),
    -- OCR finished reading a document but nobody confirmed the invoice yet.
    -- Scoped to unexpired uploads so an abandoned upload from months ago
    -- (never confirmed, never going to be) doesn't sit in this count forever.
    'ocr_pending_confirmation', (
      select count(*) from invoice_uploads
      where organization_id = target_org and ocr_status = 'succeeded' and invoice_id is null and expires_at > now()
    ),
    -- Not the same as "upcoming" above (that list is capped at 4 for display).
    -- This is a real count, so it stays correct even past the cap.
    'reminders_due_soon', (
      select count(*) from invoices
      where organization_id = target_org and status in ('pending', 'overdue')
        and next_reminder_at is not null
        and next_reminder_at::date <= ((now() at time zone 'Europe/Prague')::date + 1)
    )
  ) into result;
  return result;
end;
$$;

revoke all on function dashboard_summary(uuid, uuid) from public, anon, authenticated;
grant execute on function dashboard_summary(uuid, uuid) to service_role;
