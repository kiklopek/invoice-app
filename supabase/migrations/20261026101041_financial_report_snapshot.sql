-- Read-only report functions must share the calling statement's MVCC snapshot.
-- Aggregation formulas and existing endpoint signatures stay unchanged.
alter function public.invoice_report_summary(uuid,uuid,date,date,text,text,text,text,date) stable;
alter function public.invoice_report_rows_page(uuid,uuid,date,date,text,text,text,text,integer,integer) stable;
alter function public.payment_reconciliation_summary(uuid,uuid,date,date) stable;

create function public.financial_report_snapshot(
  target_org uuid, actor_user uuid, report_from date, report_to date,
  date_basis text, currency_filter text, status_filter text default null, customer_filter text default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare invoice_rows jsonb; import_rows jsonb; customer_rows jsonb; summary jsonb; payments jsonb; company jsonb;
  generated timestamptz := statement_timestamp(); as_of date := (statement_timestamp() at time zone 'Europe/Prague')::date;
begin
  if not exists(select 1 from public.organization_members m where m.organization_id=target_org and m.user_id=actor_user and m.role::text in ('admin','accounting','viewer')) then raise exception 'insufficient_permission'; end if;
  if report_from is null or report_to is null or report_from>report_to or report_to-report_from>3660
    or date_basis is null or date_basis not in ('issue_date','due_date','paid_at') or currency_filter is null or currency_filter!~'^[A-Z]{3}$'
    or (status_filter is not null and status_filter not in ('pending','overdue','paid','cancelled')) then raise exception 'invalid_report_filter'; end if;
  -- Same date/status/customer semantics and ordering as invoice_report_rows_page.
  select coalesce(jsonb_agg(to_jsonb(r) order by r.issue_date,r.id),'[]'::jsonb) into invoice_rows from (
    select i.id,i.invoice_number,i.counterparty_name,i.amount_without_vat,i.vat_rate,i.amount,i.paid_amount,
      i.amount-i.paid_amount as remaining_amount,i.currency,i.issue_date,i.due_date,i.paid_at,i.status,i.reminders_sent,
      i.money_evidence#>'{issued_document,totals,breakdown}' as vat_groups
    from public.invoices i where i.organization_id=target_org and i.currency=currency_filter
      and (status_filter is null or i.status=status_filter) and (customer_filter is null or i.counterparty_name=customer_filter)
      and ((date_basis='issue_date' and i.issue_date between report_from and report_to)
        or (date_basis='due_date' and i.due_date between report_from and report_to)
        or (date_basis='paid_at' and (i.paid_at at time zone 'Europe/Prague')::date between report_from and report_to))
    order by i.issue_date,i.id limit 5001
  ) r;
  if jsonb_array_length(invoice_rows)>5000 then raise exception 'report_too_large'; end if;
  if (select count(*) from (select 1 from public.bank_statement_imports b where b.organization_id=target_org and b.status='committed' and (b.committed_at at time zone 'Europe/Prague')::date between report_from and report_to limit 2001) x)>2000 then raise exception 'report_too_large'; end if;

  summary:=public.invoice_report_summary(target_org,actor_user,report_from,report_to,date_basis,currency_filter,status_filter,customer_filter,as_of);
  payments:=public.payment_reconciliation_summary(target_org,actor_user,report_from,report_to);
  select jsonb_build_object('name',o.name,'ico',o.ico,'dic',o.dic,'address',o.registered_address) into company from public.organizations o where o.id=target_org;
  -- Customer projection of the same invoice values; no new invoice/VAT calculation.
  select coalesce(jsonb_agg(to_jsonb(c) order by c.invoiced::numeric desc,c.name),'[]'::jsonb) into customer_rows from (
    select r.counterparty_name as name,sum(r.amount)::text as invoiced,
      coalesce(sum(r.paid_amount) filter(where r.status<>'cancelled'),0)::text as paid,count(*) as count
    from jsonb_to_recordset(invoice_rows) as r(counterparty_name text,amount numeric,paid_amount numeric,status text) group by r.counterparty_name
  ) c;
  -- The exact accepted/safe/review definition from payment_reconciliation_summary,
  -- projected for ALL committed imports rather than its recent-import sample.
  with committed as materialized (
    select b.* from public.bank_statement_imports b where b.organization_id=target_org and b.status='committed'
      and b.committed_at is not null and (b.committed_at at time zone 'Europe/Prague')::date between report_from and report_to
  ), stats as (
    select e.import_id,count(*) filter(where e.disposition='accepted' and e.proposal_confidence='safe') as auto_matched,
      count(*) filter(where e.disposition='accepted' and (e.proposal_confidence='review' or e.proposal_confidence is null)) as needs_review
    from public.bank_statement_entries e where e.organization_id=target_org and e.import_id in(select id from committed) group by e.import_id
  ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'filename',c.original_filename,'committed_at',c.committed_at,
    'accepted_count',c.accepted_count,'ignored_count',c.ignored_count,'error_count',c.error_count,
    'auto_matched',coalesce(s.auto_matched,0),'needs_review',coalesce(s.needs_review,0)) order by c.committed_at desc,c.id),'[]'::jsonb)
    into import_rows from committed c left join stats s on s.import_id=c.id;
  return jsonb_build_object('exact_totals',jsonb_build_object('total',summary->>'total','paid',summary->>'paid','open',summary->>'open','overdue',summary->>'overdue',
    'base',(select coalesce(sum((v->>'base')::numeric),0)::text from jsonb_array_elements(summary->'vat_breakdown') v),
    'tax',(select coalesce(sum((v->>'tax')::numeric),0)::text from jsonb_array_elements(summary->'vat_breakdown') v)),
    'exact_vat',coalesce((select jsonb_agg(jsonb_build_object('vat_rate',v->'vat_rate','base',v->>'base','tax',v->>'tax','gross',v->>'gross','count',v->'count')) from jsonb_array_elements(summary->'vat_breakdown') v),'[]'::jsonb),
    'exact_aging',coalesce((select jsonb_agg(jsonb_build_object('label',v->'label','amount',v->>'amount','count',v->'count')) from jsonb_array_elements(summary->'aging') v),'[]'::jsonb),
    'exact_debtors',coalesce((select jsonb_agg(jsonb_build_object('name',v->'name','open',v->>'open','overdue',v->>'overdue','count',v->'count','reminders',v->'reminders')) from jsonb_array_elements(summary->'debtors') v),'[]'::jsonb),
    'company',company,'generated_at',generated,'as_of',as_of,'report',summary,
    'payments',payments,'invoices',invoice_rows,'customers',customer_rows,'imports',import_rows);
end $$;
revoke all on function public.financial_report_snapshot(uuid,uuid,date,date,text,text,text,text) from public,anon,authenticated;
grant execute on function public.financial_report_snapshot(uuid,uuid,date,date,text,text,text,text) to service_role;
