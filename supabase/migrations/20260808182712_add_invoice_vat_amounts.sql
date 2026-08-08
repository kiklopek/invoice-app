alter table public.invoices
  add column amount_without_vat numeric(14,2),
  add column vat_rate numeric(5,2) not null default 0;

update public.invoices
set amount_without_vat = amount
where amount_without_vat is null;

alter table public.invoices
  alter column amount_without_vat set not null,
  add constraint invoices_amount_without_vat_positive check (amount_without_vat > 0),
  add constraint invoices_vat_rate_valid check (vat_rate >= 0 and vat_rate <= 100),
  add constraint invoices_vat_amounts_consistent check (
    abs(amount - round(amount_without_vat * (100 + vat_rate) / 100, 2)) <= 0.01
  );

create or replace function public.invoice_report_rows_page(
  target_org uuid, actor_user uuid, report_from date, report_to date,
  date_basis text, currency_filter text, status_filter text default null,
  customer_filter text default null, page_number integer default 1, page_size integer default 500
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not exists (select 1 from public.organization_members where organization_id = target_org and user_id = actor_user) then raise exception 'insufficient_permission'; end if;
  if report_from > report_to or page_number < 1 or page_size < 1 or page_size > 500 then raise exception 'invalid_request'; end if;
  if date_basis not in ('issue_date', 'due_date', 'paid_at') or currency_filter !~ '^[A-Z]{3}$' then raise exception 'invalid_filter'; end if;
  if status_filter is not null and status_filter not in ('pending', 'overdue', 'paid', 'cancelled') then raise exception 'invalid_status'; end if;

  with filtered as materialized (
    select i.invoice_number, i.counterparty_name, i.amount_without_vat, i.vat_rate, i.amount, i.paid_amount,
      i.amount - i.paid_amount as remaining_amount, i.currency, i.issue_date, i.due_date, i.paid_at,
      i.status, i.reminders_sent, i.id
    from public.invoices i where i.organization_id = target_org and i.currency = currency_filter
      and (status_filter is null or i.status = status_filter)
      and (customer_filter is null or i.counterparty_name = customer_filter)
      and ((date_basis = 'issue_date' and i.issue_date between report_from and report_to)
        or (date_basis = 'due_date' and i.due_date between report_from and report_to)
        or (date_basis = 'paid_at' and (i.paid_at at time zone 'Europe/Prague')::date between report_from and report_to))
  ), paged as (
    select * from filtered order by issue_date, id offset (page_number - 1) * page_size limit page_size
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(p) order by p.issue_date, p.id) from paged p), '[]'::jsonb),
    'total', (select count(*) from filtered)
  ) into result;
  return result;
end;
$$;
