-- Narrow machine operation: never rewrites monetary/status fields.
-- RLS bypass does not imply SQL privileges. Make a clean migration replay
-- independent of managed Supabase default table grants.
grant select, update on public.invoices, public.reminder_log to service_role;
grant select on public.reminder_policies to service_role;
create or replace function public.set_api_invoice_reminders(
  target_org uuid,
  actor_user uuid,
  target_invoice uuid,
  paused boolean
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  invoice public.invoices;
  policy_active boolean := true;
  today date := (now() at time zone 'Europe/Prague')::date;
  next_day date;
  schedule integer[];
begin
  if paused is null then raise exception 'invalid_pause_state' using errcode='22023'; end if;
  perform 1 from public.organization_members m
    where m.organization_id=target_org and m.user_id=actor_user
      and m.role='admin' and m.support_expires_at is null
    for share;
  if not found then raise exception 'insufficient_permission' using errcode='42501'; end if;
  select * into invoice from public.invoices i where i.organization_id=target_org and i.id=target_invoice for update;
  if not found then raise exception 'invoice_not_found' using errcode='P0002'; end if;

  if paused then
    -- A provider request already in flight cannot be recalled. Refuse rather
    -- than report that a potentially accepted delivery has been cancelled.
    begin
      perform 1 from public.reminder_log r where r.organization_id=target_org and r.invoice_id=target_invoice and r.status in ('queued','failed') for update nowait;
    exception when lock_not_available then
      raise exception 'reminder_in_flight' using errcode='55000';
    end;
    if exists(select 1 from public.reminder_log r where r.organization_id=target_org and r.invoice_id=target_invoice and r.status='queued' and r.lease_expires_at>now()) then
      raise exception 'reminder_in_flight' using errcode='55000';
    end if;
    update public.reminder_log set status='skipped',error_message=null,lease_token=null,lease_expires_at=null,updated_at=clock_timestamp()
      where organization_id=target_org and invoice_id=target_invoice and status in ('queued','failed');
  elsif invoice.status in ('pending','overdue') and invoice.counterparty_email<>'' then
    if invoice.reminder_policy_id is not null then
      select p.is_active into policy_active from public.reminder_policies p where p.organization_id=target_org and p.id=invoice.reminder_policy_id;
    else
      select p.is_active into policy_active from public.reminder_policies p where p.organization_id=target_org and p.is_default and p.archived_at is null;
    end if;
    if coalesce(policy_active,true) then
      schedule := case when cardinality(invoice.reminder_days_snapshot)>0 then invoice.reminder_days_snapshot else array[-3,0,7,14] end;
      -- Match initialNextReminderAt: overdue eligible work resumes today;
      -- effective_from is preserved, so obsolete policy stages stay excluded.
      select case when bool_or(d.day<=today) then today else min(d.day) end into next_day
      from (select invoice.due_date + offset_day as day from unnest(schedule) offset_day) d
      where invoice.reminder_plan_effective_from is null or d.day>=invoice.reminder_plan_effective_from;
    end if;
  end if;
  update public.invoices set
    reminders_paused=paused,
    reminders_paused_at=case when paused then coalesce(invoice.reminders_paused_at,clock_timestamp()) else null end,
    reminders_paused_by=case when paused then coalesce(invoice.reminders_paused_by,actor_user) else null end,
    next_reminder_at=case when paused or invoice.status not in ('pending','overdue') then null else next_day::timestamp at time zone 'UTC' end,
    updated_by=actor_user,
    updated_at=clock_timestamp()
  where organization_id=target_org and id=target_invoice
  returning * into invoice;
  return jsonb_build_object('invoice_id',invoice.id,'paused',invoice.reminders_paused,'next_reminder_at',invoice.next_reminder_at,'updated_at',invoice.updated_at);
end;
$$;
revoke all on function public.set_api_invoice_reminders(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_api_invoice_reminders(uuid,uuid,uuid,boolean) to service_role;

-- A payment can settle several invoices. The old invoice_id column is only
-- the single-invoice convenience link; committed allocations are authoritative.
grant select on public.bank_payments, public.bank_payment_allocations to service_role;
create or replace function public.list_api_payments_page(
  target_org uuid,
  actor_user uuid,
  target_invoice uuid default null,
  cursor_time timestamptz default null,
  cursor_id uuid default null,
  page_size integer default 50
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if page_size is null or page_size<1 or page_size>100 or (cursor_time is null)<>(cursor_id is null) then
    raise exception 'invalid_page' using errcode='22023';
  end if;
  if not exists(select 1 from public.organization_members m where m.organization_id=target_org and m.user_id=actor_user and m.role='admin' and m.support_expires_at is null) then
    raise exception 'insufficient_permission' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(row.payload order by row.created_at,row.id),'[]'::jsonb) into result
  from (
    select p.id,p.created_at,jsonb_build_object(
      'id',p.id,'amount',p.amount,'currency',p.currency,'booked_on',p.booked_on,'variable_symbol',p.variable_symbol,
      'invoice_id',p.invoice_id,'match_status',p.match_status,'matched_at',p.matched_at,'created_at',p.created_at,
      'allocations',coalesce(a.allocations,'[]'::jsonb),'allocated_amount',coalesce(a.total,0),
      'unallocated_amount',greatest(0,p.amount-coalesce(a.total,0)),
      'allocation_status',case when coalesce(a.total,0)=0 then 'unallocated' when a.total<p.amount then 'partial' when a.total=p.amount then 'allocated' else 'overallocated' end
    ) as payload
    from public.bank_payments p
    left join lateral (
      select jsonb_agg(jsonb_build_object('invoice_id',b.invoice_id,'amount',b.amount) order by b.invoice_id,b.id) as allocations,sum(b.amount) as total
      from public.bank_payment_allocations b
      join public.invoices i on i.id=b.invoice_id and i.organization_id=target_org
      where b.organization_id=target_org and b.bank_payment_id=p.id and b.is_committed
    ) a on true
    where p.organization_id=target_org
      and (target_invoice is null or p.invoice_id=target_invoice or exists(
        select 1 from public.bank_payment_allocations b
        join public.invoices i on i.id=b.invoice_id and i.organization_id=target_org
        where b.organization_id=target_org and b.bank_payment_id=p.id and b.invoice_id=target_invoice and b.is_committed
      ))
      and (cursor_time is null or (p.created_at,p.id)>(cursor_time,cursor_id))
    order by p.created_at,p.id limit page_size+1
  ) row;
  return result;
end;
$$;
revoke all on function public.list_api_payments_page(uuid,uuid,uuid,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.list_api_payments_page(uuid,uuid,uuid,timestamptz,uuid,integer) to service_role;
