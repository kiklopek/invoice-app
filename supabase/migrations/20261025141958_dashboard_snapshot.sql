-- Dashboard-only snapshot: one invoice cohort, small monthly aggregates for every
-- currency, and capped previews. No full reports or invoice pages cross the API.
create or replace function public.dashboard_snapshot(
  target_org uuid, actor_user uuid, period_from date, period_to date
) returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
declare result jsonb;
begin
  if not exists (
    select 1 from public.organization_members
    where organization_id = target_org and user_id = actor_user
      and role in ('admin', 'accounting', 'viewer')
      and (support_expires_at is null or support_expires_at > now())
  ) then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;
  if period_to is null or period_from > period_to then
    raise exception 'invalid_dashboard_period' using errcode = '22023';
  end if;

  with cohort as materialized (
    select id, invoice_number, variable_symbol, counterparty_name,
      counterparty_email, amount, paid_amount, currency, due_date, status,
      reminders_sent, created_at, issue_date, next_reminder_at
    from public.invoices
    where organization_id = target_org and issue_date <= period_to
      and (period_from is null or issue_date >= period_from)
  ), totals as (
    select currency,
      sum(amount - paid_amount) filter (where status in ('pending', 'overdue')) as open_amount,
      sum(amount - paid_amount) filter (where status = 'overdue') as overdue_amount,
      sum(paid_amount) filter (where status <> 'cancelled' and paid_amount > 0) as paid_amount
    from cohort group by currency
  ), monthly_status as materialized (
    select currency, to_char(issue_date, 'YYYY-MM') as key, status,
      sum(amount) as issued, sum(paid_amount) as paid, count(*) as count
    from cohort group by currency, to_char(issue_date, 'YYYY-MM'), status
  ), monthly_all as (
    select currency, key, sum(issued) as issued, sum(paid) as paid, sum(count) as count
    from monthly_status group by currency, key
  ), chart_currencies as (
    select currency from monthly_status group by currency
  ), charts as (
    select c.currency, jsonb_build_object(
      'monthly', (select jsonb_agg(jsonb_build_object('key', m.key, 'issued', m.issued,
        'paid', m.paid, 'count', m.count) order by m.key) from monthly_all m where m.currency = c.currency),
      'statuses', (select jsonb_object_agg(s.status, coalesce((
        select jsonb_build_object('monthly', coalesce(jsonb_agg(jsonb_build_object(
          'key', m.key, 'issued', m.issued, 'paid', m.paid, 'count', m.count) order by m.key), '[]'::jsonb))
        from monthly_status m where m.currency = c.currency and m.status = s.status
      ), '{"monthly":[]}'::jsonb)) from (values ('paid'), ('pending'), ('overdue')) s(status))
    ) as chart from chart_currencies c
  ), recent as (
    select id, invoice_number, variable_symbol, counterparty_name, counterparty_email,
      amount, paid_amount, currency, due_date, status, reminders_sent, created_at
    from cohort order by created_at desc, id desc limit 50
  ), upcoming as (
    select id, invoice_number, counterparty_name, amount, paid_amount, currency, status, next_reminder_at
    from cohort where status in ('pending', 'overdue') and next_reminder_at is not null
    order by next_reminder_at, id limit 50
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', period_from, 'to', period_to),
    'report_from', coalesce(period_from, (select min(issue_date) from cohort), period_to),
    'invoice_count', (select count(*) from cohort),
    'paid_invoice_count', (select count(*) from cohort where status = 'paid'),
    'previous_invoice_count', case when period_from is null then null else (
      select count(*) from public.invoices where organization_id = target_org
        and issue_date >= period_from - (period_to - period_from + 1)
        and issue_date < period_from
    ) end,
    'currencies', coalesce((select jsonb_agg(currency order by currency) from (
      select distinct currency from public.invoices where organization_id = target_org
    ) c), '[]'::jsonb),
    'charts', coalesce((select jsonb_object_agg(currency, chart) from charts), '{}'::jsonb),
    'open_totals', coalesce((select jsonb_object_agg(currency, open_amount) from totals where open_amount is not null), '{}'::jsonb),
    'overdue_totals', coalesce((select jsonb_object_agg(currency, overdue_amount) from totals where overdue_amount is not null), '{}'::jsonb),
    'paid_totals', coalesce((select jsonb_object_agg(currency, paid_amount) from totals where paid_amount is not null), '{}'::jsonb),
    'active_count', (select count(*) from cohort where status in ('pending', 'overdue')),
    'overdue_count', (select count(*) from cohort where status = 'overdue'),
    'reminders_sent', coalesce((select sum(reminders_sent) from cohort), 0),
    'recent', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc) from recent r), '[]'::jsonb),
    'upcoming', coalesce((select jsonb_agg(to_jsonb(u) order by u.next_reminder_at, u.id) from upcoming u), '[]'::jsonb),
    'payments_needing_review', (
      select count(*) from public.bank_statement_entries where organization_id = target_org
        and disposition = 'accepted' and (proposal_confidence = 'review' or proposal_confidence is null)
    ),
    'ocr_pending_confirmation', (
      select count(*) from public.invoice_uploads where organization_id = target_org
        and ocr_status = 'succeeded' and invoice_id is null and expires_at > now()
    ),
    'reminders_due_soon', (
      select count(*) from cohort where status in ('pending', 'overdue')
        and next_reminder_at is not null
        and (next_reminder_at at time zone 'Europe/Prague')::date <= period_to + 1
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.dashboard_snapshot(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public.dashboard_snapshot(uuid, uuid, date, date) to service_role;
