-- Keep the dashboard payload bounded while allowing both viewport panels to
-- demonstrate their independent scroll instead of stopping after 5/4 rows.
create or replace function public.dashboard_summary(target_org uuid, actor_user uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not exists (select 1 from public.organization_members where organization_id = target_org and user_id = actor_user) then
    raise exception 'insufficient_permission';
  end if;
  with currency_totals as (
    select currency,
      coalesce(sum(amount-paid_amount) filter (where status in ('pending','overdue')),0) open_amount,
      coalesce(sum(amount-paid_amount) filter (where status='overdue'),0) overdue_amount,
      coalesce(sum(paid_amount) filter (where status<>'cancelled'),0) paid_amount
    from public.invoices where organization_id=target_org group by currency
  ), recent as (
    select id,invoice_number,variable_symbol,counterparty_name,counterparty_email,
      amount,paid_amount,currency,due_date,status,reminders_sent,created_at
    from public.invoices where organization_id=target_org
    order by created_at desc,id desc limit 50
  ), upcoming as (
    select id,invoice_number,counterparty_name,amount,paid_amount,currency,status,next_reminder_at
    from public.invoices where organization_id=target_org and status in ('pending','overdue')
      and next_reminder_at is not null
    order by next_reminder_at,id limit 50
  )
  select jsonb_build_object(
    'open_totals',coalesce((select jsonb_object_agg(currency,open_amount) from currency_totals where open_amount>0),'{}'::jsonb),
    'overdue_totals',coalesce((select jsonb_object_agg(currency,overdue_amount) from currency_totals where overdue_amount>0),'{}'::jsonb),
    'paid_totals',coalesce((select jsonb_object_agg(currency,paid_amount) from currency_totals where paid_amount>0),'{}'::jsonb),
    'active_count',(select count(*) from public.invoices where organization_id=target_org and status in ('pending','overdue')),
    'overdue_count',(select count(*) from public.invoices where organization_id=target_org and status='overdue'),
    'reminders_sent',coalesce((select sum(reminders_sent) from public.invoices where organization_id=target_org),0),
    'recent',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc) from recent r),'[]'::jsonb),
    'upcoming',coalesce((select jsonb_agg(to_jsonb(u) order by u.next_reminder_at,u.id) from upcoming u),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.dashboard_summary(uuid,uuid) from public,anon,authenticated;
grant execute on function public.dashboard_summary(uuid,uuid) to service_role;
