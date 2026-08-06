-- Bounded dashboard payload: aggregates plus only the visible recent and upcoming rows.
create index if not exists invoices_org_created on invoices (organization_id, created_at desc, id desc);
create index if not exists invoices_org_next_reminder on invoices (organization_id, next_reminder_at, id)
  where status in ('pending', 'overdue') and next_reminder_at is not null;

create or replace function dashboard_summary(target_org uuid, actor_user uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not exists (select 1 from organization_members where organization_id = target_org and user_id = actor_user) then
    raise exception 'insufficient_permission';
  end if;

  with currency_totals as (
    select currency,
      coalesce(sum(amount) filter (where status in ('pending', 'overdue')), 0) as open_amount,
      coalesce(sum(amount) filter (where status = 'overdue'), 0) as overdue_amount,
      coalesce(sum(amount) filter (where status = 'paid'), 0) as paid_amount
    from invoices where organization_id = target_org group by currency
  ), recent as (
    select id, invoice_number, variable_symbol, counterparty_name, counterparty_email,
      amount, currency, due_date, status, reminders_sent, created_at
    from invoices where organization_id = target_org
    order by created_at desc, id desc limit 5
  ), upcoming as (
    select id, invoice_number, counterparty_name, amount, currency, status, next_reminder_at
    from invoices where organization_id = target_org and status in ('pending', 'overdue') and next_reminder_at is not null
    order by next_reminder_at, id limit 4
  )
  select jsonb_build_object(
    'open_totals', coalesce((select jsonb_object_agg(currency, open_amount) from currency_totals where open_amount > 0), '{}'::jsonb),
    'overdue_totals', coalesce((select jsonb_object_agg(currency, overdue_amount) from currency_totals where overdue_amount > 0), '{}'::jsonb),
    'paid_totals', coalesce((select jsonb_object_agg(currency, paid_amount) from currency_totals where paid_amount > 0), '{}'::jsonb),
    'active_count', (select count(*) from invoices where organization_id = target_org and status in ('pending', 'overdue')),
    'overdue_count', (select count(*) from invoices where organization_id = target_org and status = 'overdue'),
    'reminders_sent', coalesce((select sum(reminders_sent) from invoices where organization_id = target_org), 0),
    'recent', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc) from recent r), '[]'::jsonb),
    'upcoming', coalesce((select jsonb_agg(to_jsonb(u) order by u.next_reminder_at, u.id) from upcoming u), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function dashboard_summary(uuid, uuid) from public, anon, authenticated;
grant execute on function dashboard_summary(uuid, uuid) to service_role;
