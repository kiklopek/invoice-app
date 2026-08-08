-- Keep Czech report labels independent of the SQL client's file encoding.
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
      coalesce(sum(paid_amount), 0) as paid
    from filtered group by 1
  ), debtor_values as (
    select counterparty_name as name, sum(amount - paid_amount) as open,
      coalesce(sum(amount - paid_amount) filter (where status = 'overdue'), 0) as overdue,
      count(*) as count, sum(reminders_sent) as reminders
    from filtered where status in ('pending', 'overdue') group by counterparty_name
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
      'cancelled', (select count(*) from filtered where status = 'cancelled')
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
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('key', month_key, 'issued', issued, 'paid', paid) order by month_key) from monthly_values), '[]'::jsonb),
    'debtors', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'open', open, 'overdue', overdue, 'count', count, 'reminders', reminders) order by open desc, name) from debtor_values), '[]'::jsonb),
    'currencies', coalesce((select jsonb_agg(currency order by currency) from (select distinct currency from invoices where organization_id = target_org) c), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(counterparty_name order by counterparty_name) from (select distinct counterparty_name from invoices where organization_id = target_org) n), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function invoice_report_summary(uuid, uuid, date, date, text, text, text, text, date) from public, anon, authenticated;
grant execute on function invoice_report_summary(uuid, uuid, date, date, text, text, text, text, date) to service_role;
