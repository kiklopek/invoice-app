-- Literal multi-word search, shared with src/lib/text-search.ts.
-- No LIKE wildcards, dynamic SQL or new extensions. Search stays within the
-- organization selected by the caller, before pagination/totals/export.
create or replace function public.normalize_search_text(value text)
returns text language sql immutable parallel safe security invoker set search_path = '' as $$
  select trim(regexp_replace(lower(regexp_replace(normalize(coalesce(value, ''), NFD), U&'[\0300-\036f]', '', 'g')), '[[:space:]]+', ' ', 'g'));
$$;
create or replace function public.compact_search_text(value text)
returns text language sql immutable parallel safe security invoker set search_path = '' as $$
  select regexp_replace(value, '[[:space:].+_/()-]', '', 'g');
$$;
create or replace function public.search_text_matches(fields text[], search_query text)
returns boolean language sql immutable parallel safe security invoker set search_path = '' as $$
  with normalized_fields as materialized (
    select public.normalize_search_text(value) value from unnest(fields) value
  ), terms as (
    select term, public.compact_search_text(term) compact
    from unnest(string_to_array(public.normalize_search_text(search_query), ' ')) term
    where term <> ''
  )
  select not exists (
    select 1 from terms where not exists (
      select 1 from normalized_fields field where strpos(field.value, terms.term) > 0
        or (length(terms.compact) >= 2 and strpos(public.compact_search_text(field.value), terms.compact) > 0)
    )
  );
$$;
revoke all on function public.normalize_search_text(text), public.compact_search_text(text), public.search_text_matches(text[],text) from public, anon, authenticated;
grant execute on function public.normalize_search_text(text), public.compact_search_text(text), public.search_text_matches(text[],text) to service_role;

-- A trigram prefilter keeps normalized search indexed. The full matcher
-- below still verifies every word against individual fields.
create or replace function public.search_document(fields text[])
returns text language sql immutable parallel safe security invoker set search_path = '' as $$
  with normalized as materialized (
    select public.normalize_search_text(value) value from unnest(fields) value
  )
  select coalesce(string_agg(value || chr(31) || public.compact_search_text(value), chr(31)), '') from normalized;
$$;
create or replace function public.search_prefilter(search_query text)
returns text language sql immutable parallel safe security invoker set search_path = '' as $$
  with terms as (
    select case when length(public.compact_search_text(term)) >= 2 then public.compact_search_text(term) else term end value
    from unnest(string_to_array(public.normalize_search_text(search_query), ' ')) term where term <> ''
  )
  select '%' || replace(replace(replace(value, chr(92), chr(92)||chr(92)), '%', chr(92)||'%'), '_', chr(92)||'_') || '%'
  from terms order by length(value) desc, value limit 1;
$$;
revoke all on function public.search_document(text[]), public.search_prefilter(text) from public,anon,authenticated;
grant execute on function public.search_document(text[]), public.search_prefilter(text) to service_role;

create index invoices_normalized_search_trgm on public.invoices using gin (
  public.search_document(array[invoice_number, counterparty_name, counterparty_ico, counterparty_dic, counterparty_email, variable_symbol, notes]) extensions.gin_trgm_ops
);
create index customers_normalized_search_trgm on public.customers using gin (
  public.search_document(array[name, ico, dic, email, phone, address]) extensions.gin_trgm_ops
);

create or replace function public.list_invoices_page_filtered(
  target_org uuid, actor_user uuid, search_query text default null, status_filter text default null,
  currency_filter text default null, issue_from date default null, issue_to date default null,
  due_from date default null, due_to date default null, amount_min numeric default null, amount_max numeric default null,
  payment_state text default null, bank_match_state text default null, page_number integer default 1, page_size integer default 25
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; search_pattern text := public.search_prefilter(search_query);
begin
  if not exists(select 1 from public.organization_members where organization_id=target_org and user_id=actor_user) then raise exception 'insufficient_permission'; end if;
  if page_number<1 or page_size<1 or page_size>500 then raise exception 'invalid_pagination'; end if;
  if status_filter is not null and status_filter not in('pending','overdue','paid','cancelled','closed') then raise exception 'invalid_status'; end if;
  if payment_state is not null and payment_state not in('unpaid','partial','paid') then raise exception 'invalid_payment_state'; end if;
  if bank_match_state is not null and bank_match_state not in('matched','unmatched') then raise exception 'invalid_bank_match_state'; end if;
  if issue_from>issue_to or due_from>due_to or amount_min<0 or amount_max<0 or amount_min>amount_max then raise exception 'invalid_range'; end if;
  if length(coalesce(search_query, '')) > 100 then raise exception 'invalid_search'; end if;
  with filtered as materialized(
    select invoice.* from public.invoices invoice
    where invoice.organization_id=target_org
      and(status_filter is null or invoice.status=status_filter or(status_filter='closed' and invoice.status in('paid','cancelled')))
      and(currency_filter is null or invoice.currency=currency_filter)
      and(issue_from is null or invoice.issue_date>=issue_from) and(issue_to is null or invoice.issue_date<=issue_to)
      and(due_from is null or invoice.due_date>=due_from) and(due_to is null or invoice.due_date<=due_to)
      and(amount_min is null or invoice.amount>=amount_min) and(amount_max is null or invoice.amount<=amount_max)
      and(payment_state is null or payment_state='unpaid' and invoice.paid_amount=0
        or payment_state='partial' and invoice.paid_amount>0 and invoice.paid_amount<invoice.amount
        or payment_state='paid' and invoice.paid_amount=invoice.amount)
      and(bank_match_state is null or bank_match_state='matched' and exists(select 1 from public.bank_payment_allocations allocation where allocation.organization_id=target_org and allocation.invoice_id=invoice.id and allocation.is_committed)
        or bank_match_state='unmatched' and not exists(select 1 from public.bank_payment_allocations allocation where allocation.organization_id=target_org and allocation.invoice_id=invoice.id and allocation.is_committed))
      and (search_pattern is null or (
        public.search_document(array[invoice.invoice_number, invoice.counterparty_name, invoice.counterparty_ico,
          invoice.counterparty_dic, invoice.counterparty_email, invoice.variable_symbol, invoice.notes]) like search_pattern
        and public.search_text_matches(array[invoice.invoice_number, invoice.counterparty_name,
        invoice.counterparty_ico, invoice.counterparty_dic, invoice.counterparty_email,
        invoice.variable_symbol, invoice.notes], search_query)))
  ), paged as(
    select * from filtered order by case status when 'overdue' then 0 when 'pending' then 1 when 'paid' then 2 else 3 end,
      case when status in('overdue','pending') then due_date end asc nulls last,
      case when status='paid' then paid_at end desc nulls last,updated_at desc,id asc
    offset(page_number-1)*page_size limit page_size
  ), totals as(select currency,sum(amount-paid_amount) amount from filtered where status in('pending','overdue') group by currency),
  currencies as(select distinct currency from public.invoices where organization_id=target_org)
  select jsonb_build_object('invoices',coalesce((select jsonb_agg(to_jsonb(row)) from paged row),'[]'::jsonb),
    'total',(select count(*) from filtered),'open_totals',coalesce((select jsonb_object_agg(currency,amount) from totals),'{}'::jsonb),
    'currencies',coalesce((select jsonb_agg(currency order by currency) from currencies),'[]'::jsonb),
    'active_count',(select count(*) from public.invoices where organization_id=target_org and status in('pending','overdue'))) into result;
  return result;
end $$;
revoke all on function public.list_invoices_page_filtered(uuid,uuid,text,text,text,date,date,date,date,numeric,numeric,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.list_invoices_page_filtered(uuid,uuid,text,text,text,date,date,date,date,numeric,numeric,text,text,integer,integer) to service_role;

-- Backend identity is checked before this service-role-only RPC is called.
create or replace function public.search_customers(target_org uuid, actor_user uuid, search_query text)
returns table(id uuid, name text, ico text, dic text, email text)
language plpgsql security invoker set search_path = '' as $$
declare search_pattern text := public.search_prefilter(search_query);
begin
  if not exists(select 1 from public.organization_members where organization_id=target_org and user_id=actor_user) then
    raise exception 'insufficient_permission';
  end if;
  if length(coalesce(search_query, '')) > 100 then raise exception 'invalid_search'; end if;
  if length(public.normalize_search_text(search_query)) < 2 then return; end if;
  return query
    select customer.id, customer.name, customer.ico, customer.dic, customer.email
    from public.customers customer
    where customer.organization_id=target_org
      and public.search_document(array[customer.name, customer.ico, customer.dic, customer.email, customer.phone, customer.address]) like search_pattern
      and public.search_text_matches(array[customer.name, customer.ico, customer.dic, customer.email, customer.phone, customer.address], search_query)
    order by case when public.normalize_search_text(customer.name)=public.normalize_search_text(search_query) then 0
      when starts_with(public.normalize_search_text(customer.name),public.normalize_search_text(search_query)) then 1 else 2 end,
      customer.name, customer.id
    limit 10;
end $$;
revoke all on function public.search_customers(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.search_customers(uuid,uuid,text) to service_role;
