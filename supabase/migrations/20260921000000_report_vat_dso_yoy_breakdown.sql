-- Extends invoice_report_summary (20260808000000_baseline_schema.sql) with
-- report sections an accountant/CEO needs at month/year end: a VAT-rate
-- breakdown (for the DPH return), DSO (days sales outstanding), customer
-- revenue concentration, a year-over-year monthly comparison, and cancelled
-- invoice amounts alongside the existing cancelled count. Every existing key
-- in the returned jsonb keeps its exact prior shape -- this is additive only,
-- so the current reports-client.tsx keeps working unchanged until it's
-- updated in a later step to read the new fields.
--
-- yoy_monthly is the one field that reads outside [report_from, report_to]
-- on purpose: it needs the same calendar months from the prior year to
-- compare against, so its two CTEs query invoices directly (not the
-- `filtered` CTE, which is scoped to the requested window).
create or replace function invoice_report_summary(
  target_org uuid, actor_user uuid, report_from date, report_to date,
  date_basis text, currency_filter text, status_filter text default null,
  customer_filter text default null, as_of_date date default current_date
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user) then raise exception 'insufficient_permission'; end if;
  if report_from > report_to then raise exception 'invalid_period'; end if;
  if date_basis not in ('issue_date', 'due_date', 'paid_at') then raise exception 'invalid_date_basis'; end if;
  if currency_filter !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;
  if status_filter is not null and status_filter not in ('pending', 'overdue', 'paid', 'cancelled') then raise exception 'invalid_status'; end if;

  with filtered as materialized (
    select i.* from invoices i where i.organization_id = target_org
      and i.currency = currency_filter
      and (status_filter is null or i.status = status_filter)
      and (customer_filter is null or i.counterparty_name = customer_filter)
      and ((date_basis = 'issue_date' and i.issue_date between report_from and report_to)
        or (date_basis = 'due_date' and i.due_date between report_from and report_to)
        or (date_basis = 'paid_at' and (i.paid_at at time zone 'Europe/Prague')::date between report_from and report_to))
  ), aging_values as (
    select case when as_of_date - due_date <= 0 then 0 when as_of_date - due_date <= 7 then 1 when as_of_date - due_date <= 14 then 2 when as_of_date - due_date <= 30 then 3 else 4 end as bucket,
      sum(amount - paid_amount) as amount, count(*) as count
    from filtered where status in ('pending', 'overdue') group by 1
  ), monthly_values as (
    select to_char(issue_date, 'YYYY-MM') as month_key, sum(amount) as issued,
      coalesce(sum(paid_amount), 0) as paid, count(*) as count
    from filtered group by 1
  ), debtor_values as (
    select counterparty_name as name, sum(amount - paid_amount) as open,
      coalesce(sum(amount - paid_amount) filter (where status = 'overdue'), 0) as overdue,
      count(*) as count, sum(reminders_sent) as reminders
    from filtered where status in ('pending', 'overdue') group by counterparty_name
  ), vat_values as (
    select vat_rate,
      sum(amount_without_vat) as base,
      sum(amount - amount_without_vat) as tax,
      sum(amount) as gross,
      count(*) as count
    from filtered group by vat_rate
  ), paid_settled as (
    -- DSO only counts invoices actually settled in full (status = 'paid'),
    -- not partial payments -- paid_at is only ever set once an invoice
    -- reaches full payoff elsewhere in this codebase, so this is the
    -- standard "days to full settlement" reading of the metric, not an
    -- invented weighting scheme for partial payments.
    select issue_date, (paid_at at time zone 'Europe/Prague')::date as paid_date
    from filtered where status = 'paid' and paid_at is not null
  ), dso_monthly_values as (
    select to_char(paid_date, 'YYYY-MM') as month_key,
      avg(paid_date - issue_date) as avg_days, count(*) as count
    from paid_settled group by 1
  ), customer_revenue as (
    select counterparty_name as name, sum(amount) as revenue, count(*) as count
    from filtered group by counterparty_name
  ), customer_revenue_ranked as (
    select *, row_number() over (order by revenue desc) as rank from customer_revenue
  ), yoy_current as (
    select to_char(i.issue_date, 'MM') as month_num, sum(i.amount) as total
    from invoices i where i.organization_id = target_org and i.currency = currency_filter
      and (status_filter is null or i.status = status_filter)
      and (customer_filter is null or i.counterparty_name = customer_filter)
      and i.issue_date between report_from and report_to
    group by 1
  ), yoy_prior as (
    select to_char(i.issue_date, 'MM') as month_num, sum(i.amount) as total
    from invoices i where i.organization_id = target_org and i.currency = currency_filter
      and (status_filter is null or i.status = status_filter)
      and (customer_filter is null or i.counterparty_name = customer_filter)
      and i.issue_date between (report_from - interval '1 year')::date and (report_to - interval '1 year')::date
    group by 1
  )
  select jsonb_build_object(
    'invoice_count', (select count(*) from filtered),
    'total', coalesce((select sum(amount) from filtered), 0),
    'paid', coalesce((select sum(paid_amount) from filtered where status <> 'cancelled'), 0),
    'overdue', coalesce((select sum(amount - paid_amount) from filtered where status = 'overdue'), 0),
    'open', coalesce((select sum(amount - paid_amount) from filtered where status in ('pending', 'overdue')), 0),
    'paid_rate', coalesce((select round(100 * coalesce(sum(paid_amount) filter (where status <> 'cancelled'), 0) / nullif(coalesce(sum(amount) filter (where status <> 'cancelled'), 0), 0)) from filtered), 0)::integer,
    'counts', jsonb_build_object(
      'pending', (select count(*) from filtered where status = 'pending'),
      'overdue', (select count(*) from filtered where status = 'overdue'),
      'paid', (select count(*) from filtered where status = 'paid'),
      'cancelled', (select count(*) from filtered where status = 'cancelled'),
      'cancelled_amount', coalesce((select sum(amount) from filtered where status = 'cancelled'), 0)
    ),
    'aging', coalesce((select jsonb_agg(jsonb_build_object(
      'label', case g.bucket
        when 0 then U&'P\0159ed splatnost\00ED'
        when 1 then U&'1\20137 dn\00ED'
        when 2 then U&'8\201314 dn\00ED'
        when 3 then U&'15\201330 dn\00ED'
        else U&'V\00EDce ne\017E 30 dn\00ED'
      end,
      'amount', coalesce(a.amount, 0), 'count', coalesce(a.count, 0)
    ) order by g.bucket) from generate_series(0, 4) g(bucket) left join aging_values a using (bucket)), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('key', month_key, 'issued', issued, 'paid', paid, 'count', count) order by month_key) from monthly_values), '[]'::jsonb),
    'debtors', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'open', open, 'overdue', overdue, 'count', count, 'reminders', reminders) order by open desc, name) from debtor_values), '[]'::jsonb),
    'currencies', coalesce((select jsonb_agg(currency order by currency) from (select distinct currency from invoices where organization_id = target_org) c), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(counterparty_name order by counterparty_name) from (select distinct counterparty_name from invoices where organization_id = target_org) n), '[]'::jsonb),
    'vat_breakdown', coalesce((select jsonb_agg(jsonb_build_object(
      'vat_rate', vat_rate, 'base', base, 'tax', tax, 'gross', gross, 'count', count
    ) order by vat_rate) from vat_values), '[]'::jsonb),
    'dso', jsonb_build_object(
      'avg_days', coalesce((select round(avg(paid_date - issue_date), 1) from paid_settled), 0),
      'paid_invoice_count', (select count(*) from paid_settled)
    ),
    'dso_monthly', coalesce((select jsonb_agg(jsonb_build_object(
      'key', month_key, 'avg_days', round(avg_days, 1), 'count', count
    ) order by month_key) from dso_monthly_values), '[]'::jsonb),
    'customer_concentration', coalesce((
      select jsonb_agg(row) from (
        select jsonb_build_object('name', name, 'revenue', revenue, 'count', count) as row
        from customer_revenue_ranked where rank <= 10
        union all
        select jsonb_build_object('name', U&'Ostatn\00ED', 'revenue', sum(revenue), 'count', sum(count))
        from customer_revenue_ranked where rank > 10 having sum(revenue) > 0
      ) rows
    ), '[]'::jsonb),
    -- Keyed by month-number ('MM') only, not year+month, because this
    -- compares the same calendar month across two different years -- the
    -- client labels each row using report_to's year / report_to's year
    -- minus 1 for display, not anything derived from the row itself.
    'yoy_monthly', coalesce((select jsonb_agg(jsonb_build_object(
      'month', coalesce(c.month_num, p.month_num),
      'current_year', coalesce(c.total, 0), 'prior_year', coalesce(p.total, 0)
    ) order by coalesce(c.month_num, p.month_num))
    from yoy_current c full outer join yoy_prior p using (month_num)), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
