-- Server-side report aggregation and bounded export pages.
create index if not exists invoices_report_issue on invoices (organization_id, currency, issue_date);
create index if not exists invoices_report_due on invoices (organization_id, currency, due_date);
create index if not exists invoices_report_paid on invoices (organization_id, currency, ((paid_at at time zone 'Europe/Prague')::date));
create index if not exists invoices_report_customer on invoices (organization_id, counterparty_name);

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
    select i.* from invoices i where i.organization_id = target_org and i.currency = currency_filter
      and (status_filter is null or i.status = status_filter) and (customer_filter is null or i.counterparty_name = customer_filter)
      and ((date_basis = 'issue_date' and i.issue_date between report_from and report_to)
        or (date_basis = 'due_date' and i.due_date between report_from and report_to)
        or (date_basis = 'paid_at' and (i.paid_at at time zone 'Europe/Prague')::date between report_from and report_to))
  ), aging_values as (
    select case when as_of_date - due_date <= 0 then 0 when as_of_date - due_date <= 7 then 1 when as_of_date - due_date <= 14 then 2 when as_of_date - due_date <= 30 then 3 else 4 end as bucket,
      sum(amount) as amount, count(*) as count from filtered where status in ('pending', 'overdue') group by 1
  ), monthly_values as (
    select to_char(issue_date, 'YYYY-MM') as month_key, sum(amount) as issued, coalesce(sum(amount) filter (where status = 'paid'), 0) as paid from filtered group by 1
  ), debtor_values as (
    select counterparty_name as name, sum(amount) as open, coalesce(sum(amount) filter (where status = 'overdue'), 0) as overdue,
      count(*) as count, sum(reminders_sent) as reminders from filtered where status in ('pending', 'overdue') group by counterparty_name
  )
  select jsonb_build_object(
    'invoice_count', (select count(*) from filtered), 'total', coalesce((select sum(amount) from filtered), 0),
    'paid', coalesce((select sum(amount) from filtered where status = 'paid'), 0),
    'overdue', coalesce((select sum(amount) from filtered where status = 'overdue'), 0),
    'open', coalesce((select sum(amount) from filtered where status in ('pending', 'overdue')), 0),
    'paid_rate', coalesce((select round(100 * coalesce(sum(amount) filter (where status = 'paid'), 0) / nullif(coalesce(sum(amount) filter (where status <> 'cancelled'), 0), 0)) from filtered), 0)::integer,
    'counts', jsonb_build_object('pending', (select count(*) from filtered where status = 'pending'), 'overdue', (select count(*) from filtered where status = 'overdue'), 'paid', (select count(*) from filtered where status = 'paid'), 'cancelled', (select count(*) from filtered where status = 'cancelled')),
    'aging', coalesce((select jsonb_agg(jsonb_build_object('label', case g.bucket when 0 then 'Před splatností' when 1 then '1–7 dní' when 2 then '8–14 dní' when 3 then '15–30 dní' else 'Více než 30 dní' end, 'amount', coalesce(a.amount, 0), 'count', coalesce(a.count, 0)) order by g.bucket) from generate_series(0, 4) g(bucket) left join aging_values a using (bucket)), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('key', month_key, 'issued', issued, 'paid', paid) order by month_key) from monthly_values), '[]'::jsonb),
    'debtors', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'open', open, 'overdue', overdue, 'count', count, 'reminders', reminders) order by open desc, name) from debtor_values), '[]'::jsonb),
    'currencies', coalesce((select jsonb_agg(currency order by currency) from (select distinct currency from invoices where organization_id = target_org) c), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(counterparty_name order by counterparty_name) from (select distinct counterparty_name from invoices where organization_id = target_org) n), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function invoice_report_rows_page(
  target_org uuid, actor_user uuid, report_from date, report_to date, date_basis text,
  currency_filter text, status_filter text default null, customer_filter text default null,
  page_number integer default 1, page_size integer default 500
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user) then raise exception 'insufficient_permission'; end if;
  if report_from > report_to or page_number < 1 or page_size < 1 or page_size > 500 then raise exception 'invalid_request'; end if;
  if date_basis not in ('issue_date', 'due_date', 'paid_at') or currency_filter !~ '^[A-Z]{3}$' then raise exception 'invalid_filter'; end if;
  if status_filter is not null and status_filter not in ('pending', 'overdue', 'paid', 'cancelled') then raise exception 'invalid_status'; end if;
  with filtered as materialized (
    select i.invoice_number, i.counterparty_name, i.amount, i.currency, i.issue_date, i.due_date, i.paid_at, i.status, i.reminders_sent, i.id
    from invoices i where i.organization_id = target_org and i.currency = currency_filter
      and (status_filter is null or i.status = status_filter) and (customer_filter is null or i.counterparty_name = customer_filter)
      and ((date_basis = 'issue_date' and i.issue_date between report_from and report_to)
        or (date_basis = 'due_date' and i.due_date between report_from and report_to)
        or (date_basis = 'paid_at' and (i.paid_at at time zone 'Europe/Prague')::date between report_from and report_to))
  ), paged as (select * from filtered order by issue_date, id offset (page_number - 1) * page_size limit page_size)
  select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(p) order by p.issue_date, p.id) from paged p), '[]'::jsonb), 'total', (select count(*) from filtered)) into result;
  return result;
end;
$$;

revoke all on function invoice_report_summary(uuid, uuid, date, date, text, text, text, text, date) from public, anon, authenticated;
grant execute on function invoice_report_summary(uuid, uuid, date, date, text, text, text, text, date) to service_role;
revoke all on function invoice_report_rows_page(uuid, uuid, date, date, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function invoice_report_rows_page(uuid, uuid, date, date, text, text, text, text, integer, integer) to service_role;
