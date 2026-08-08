-- Extend the paginated list with a closed state used by the invoice archive.
create or replace function list_invoices_page(
  target_org uuid, actor_user uuid, search_query text default null,
  status_filter text default null, currency_filter text default null,
  issue_from date default null, issue_to date default null,
  page_number integer default 1, page_size integer default 25
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not exists (
    select 1 from organization_members
    where organization_id = target_org and user_id = actor_user
  ) then raise exception 'insufficient_permission'; end if;
  if page_number < 1 or page_size < 1 or page_size > 500 then raise exception 'invalid_pagination'; end if;
  if status_filter is not null and status_filter not in ('pending', 'overdue', 'paid', 'cancelled', 'closed') then raise exception 'invalid_status'; end if;
  if currency_filter is not null and currency_filter !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;
  if issue_from is not null and issue_to is not null and issue_from > issue_to then raise exception 'invalid_period'; end if;

  with filtered as materialized (
    select i.* from invoices i
    where i.organization_id = target_org
      and (status_filter is null or i.status = status_filter or (status_filter = 'closed' and i.status in ('paid', 'cancelled')))
      and (currency_filter is null or i.currency = currency_filter)
      and (issue_from is null or i.issue_date >= issue_from)
      and (issue_to is null or i.issue_date <= issue_to)
      and (
        nullif(trim(search_query), '') is null
        or i.invoice_number ilike '%' || trim(search_query) || '%'
        or i.counterparty_name ilike '%' || trim(search_query) || '%'
        or i.counterparty_email ilike '%' || trim(search_query) || '%'
        or coalesce(i.variable_symbol, '') ilike '%' || trim(search_query) || '%'
      )
  ), paged as (
    select * from filtered
    order by
      case status when 'overdue' then 0 when 'pending' then 1 when 'paid' then 2 else 3 end,
      case when status in ('overdue', 'pending') then due_date end asc nulls last,
      case when status = 'paid' then paid_at end desc nulls last,
      updated_at desc,
      id asc
    offset (page_number - 1) * page_size limit page_size
  ), totals as (
    select currency, sum(amount - paid_amount) as amount from filtered
    where status in ('pending', 'overdue') group by currency
  ), available_currencies as (
    select distinct currency from invoices where organization_id = target_org
  )
  select jsonb_build_object(
    'invoices', coalesce((select jsonb_agg(to_jsonb(p) order by
      case p.status when 'overdue' then 0 when 'pending' then 1 when 'paid' then 2 else 3 end,
      case when p.status in ('overdue', 'pending') then p.due_date end asc nulls last,
      case when p.status = 'paid' then p.paid_at end desc nulls last,
      p.updated_at desc,
      p.id asc
    ) from paged p), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'open_totals', coalesce((select jsonb_object_agg(currency, amount) from totals), '{}'::jsonb),
    'currencies', coalesce((select jsonb_agg(currency order by currency) from available_currencies), '[]'::jsonb),
    'active_count', (select count(*) from invoices where organization_id = target_org and status in ('pending', 'overdue'))
  ) into result;
  return result;
end;
$$;

revoke all on function list_invoices_page(uuid, uuid, text, text, text, date, date, integer, integer) from public, anon, authenticated;
grant execute on function list_invoices_page(uuid, uuid, text, text, text, date, date, integer, integer) to service_role;
