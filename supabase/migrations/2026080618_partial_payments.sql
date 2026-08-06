-- Multiple bank transfers may settle one invoice. The invoice keeps an atomically
-- maintained paid amount so every list and report can use the real outstanding balance.
alter table invoices add column if not exists paid_amount numeric(14,2) not null default 0;
update invoices set paid_amount = amount where status = 'paid';
alter table invoices drop constraint if exists invoices_paid_amount_check;
alter table invoices add constraint invoices_paid_amount_check
  check (paid_amount >= 0 and paid_amount <= amount);
alter table invoices drop constraint if exists invoices_payment_balance_state_check;
alter table invoices add constraint invoices_payment_balance_state_check check (
  (status = 'paid' and paid_amount = amount)
  or (status in ('pending', 'overdue') and paid_amount < amount)
  or (status = 'cancelled' and paid_amount = 0)
);

drop index if exists bank_payments_one_match_per_invoice;

alter table invoice_events drop constraint if exists invoice_events_event_type_check;
alter table invoice_events add constraint invoice_events_event_type_check check (event_type in (
  'created', 'updated', 'paid', 'reopened', 'cancelled', 'overdue',
  'reminders_paused', 'reminders_resumed', 'payment_changed'
));

create or replace function audit_invoice_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare fields text[]; status_event text;
begin
  if tg_op = 'INSERT' then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type)
    values (new.organization_id, new.id, new.created_by, 'created');
    return new;
  end if;
  if new.status is distinct from old.status then
    status_event := case when new.status = 'paid' then 'paid'
      when old.status = 'paid' and new.status in ('pending', 'overdue') then 'reopened'
      when new.status = 'cancelled' then 'cancelled'
      when new.status = 'overdue' then 'overdue' else 'updated' end;
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type, details)
    values (new.organization_id, new.id, case when status_event = 'overdue' then null else new.updated_by end,
      status_event, jsonb_build_object('from', old.status, 'to', new.status, 'paid_at', new.paid_at,
        'paid_amount', new.paid_amount, 'remaining', new.amount - new.paid_amount));
  elsif new.paid_at is distinct from old.paid_at and new.status = 'paid' then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type, details)
    values (new.organization_id, new.id, new.updated_by, 'paid', jsonb_build_object('paid_at', new.paid_at, 'corrected', true));
  end if;
  if new.reminders_paused is distinct from old.reminders_paused then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type)
    values (new.organization_id, new.id, coalesce(new.reminders_paused_by, new.updated_by),
      case when new.reminders_paused then 'reminders_paused' else 'reminders_resumed' end);
  end if;
  if new.paid_amount is distinct from old.paid_amount and new.status <> 'paid' and old.status <> 'paid' then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type, details)
    values (new.organization_id, new.id, new.updated_by, 'payment_changed', jsonb_build_object(
      'from', old.paid_amount, 'to', new.paid_amount, 'remaining', new.amount - new.paid_amount));
  end if;
  fields := array_remove(array[
    case when new.invoice_number is distinct from old.invoice_number then 'invoice_number' end,
    case when new.counterparty_name is distinct from old.counterparty_name then 'counterparty_name' end,
    case when new.counterparty_ico is distinct from old.counterparty_ico then 'counterparty_ico' end,
    case when new.counterparty_dic is distinct from old.counterparty_dic then 'counterparty_dic' end,
    case when new.counterparty_email is distinct from old.counterparty_email then 'counterparty_email' end,
    case when new.variable_symbol is distinct from old.variable_symbol then 'variable_symbol' end,
    case when new.amount is distinct from old.amount then 'amount' end,
    case when new.currency is distinct from old.currency then 'currency' end,
    case when new.issue_date is distinct from old.issue_date then 'issue_date' end,
    case when new.due_date is distinct from old.due_date then 'due_date' end,
    case when new.notes is distinct from old.notes then 'notes' end
  ]::text[], null);
  if cardinality(fields) > 0 then
    insert into invoice_events (organization_id, invoice_id, actor_user_id, event_type, details)
    values (new.organization_id, new.id, new.updated_by, 'updated', jsonb_build_object('fields', fields));
  end if;
  return new;
end;
$$;

create or replace function assign_bank_payment(target_org uuid, target_payment uuid, target_invoice uuid, actor_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p bank_payments%rowtype; i invoices%rowtype; new_paid numeric; company_today date := (now() at time zone 'Europe/Prague')::date;
begin
  if not exists (select 1 from organization_members where organization_id=target_org and user_id=actor_user and role in ('accounting','admin')) then raise exception 'insufficient payment assignment permission'; end if;
  select * into p from bank_payments where id=target_payment and organization_id=target_org and match_status in ('unmatched','ambiguous') for update;
  if not found then raise exception 'payment is not available for assignment'; end if;
  select * into i from invoices where id=target_invoice and organization_id=target_org and status in ('pending','overdue') for update;
  if not found then raise exception 'invoice is not available for assignment'; end if;
  if p.currency <> i.currency or p.amount > i.amount-i.paid_amount then raise exception 'payment exceeds remaining amount or currency does not match invoice'; end if;
  new_paid := i.paid_amount+p.amount;
  update bank_payments set invoice_id=i.id, match_status='matched', matched_at=now(), unmatched_at=null, unmatched_by=null where id=p.id;
  update invoices set paid_amount=new_paid,
    status=case when new_paid=amount then 'paid' when due_date<company_today then 'overdue' else 'pending' end,
    paid_at=case when new_paid=amount then (p.booked_on+time '12:00') at time zone 'Europe/Prague' else null end,
    next_reminder_at=case when new_paid=amount then null else next_reminder_at end,
    updated_by=actor_user, updated_at=now() where id=i.id;
  return jsonb_build_object('payment_id',p.id,'invoice_id',i.id,'invoice_number',i.invoice_number,'status','matched',
    'settlement',case when new_paid=i.amount then 'full' else 'partial' end,'paid_amount',new_paid,
    'remaining',i.amount-new_paid,'invoice_status',case when new_paid=i.amount then 'paid' when i.due_date<company_today then 'overdue' else 'pending' end);
end; $$;
revoke all on function assign_bank_payment(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function assign_bank_payment(uuid,uuid,uuid,uuid) to service_role;

create or replace function unassign_bank_payment(target_org uuid, target_payment uuid, actor_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p bank_payments%rowtype; i invoices%rowtype; new_paid numeric; new_status text;
  policy_days integer[] := array[-3,0,7,14]; policy_active boolean := true;
  company_today date := (now() at time zone 'Europe/Prague')::date; next_time_value timestamptz;
begin
  if not exists (select 1 from organization_members where organization_id=target_org and user_id=actor_user and role in ('accounting','admin')) then raise exception 'insufficient payment unassignment permission'; end if;
  select * into p from bank_payments where id=target_payment and organization_id=target_org and match_status='matched' and invoice_id is not null for update;
  if not found then raise exception 'matched payment not found'; end if;
  select * into i from invoices where id=p.invoice_id and organization_id=target_org for update;
  if not found then raise exception 'invoice not found'; end if;
  new_paid := greatest(0,i.paid_amount-p.amount); new_status := case when i.due_date<company_today then 'overdue' else 'pending' end;
  select days_from_due,is_active into policy_days,policy_active from reminder_policies where organization_id=target_org
    and (id=i.reminder_policy_id or (i.reminder_policy_id is null and is_default)) order by (id=i.reminder_policy_id) desc limit 1;
  next_time_value := case when i.reminders_paused or not coalesce(policy_active,true) then null else (
    select case when count(*) filter(where i.due_date+d<=company_today)>0 then (company_today+time '06:00') at time zone 'Europe/Prague'
      else ((min(i.due_date+d))+time '06:00') at time zone 'Europe/Prague' end from unnest(coalesce(policy_days,array[-3,0,7,14])) d) end;
  update bank_payments set invoice_id=null,match_status='unmatched',matched_at=null,unmatched_at=now(),unmatched_by=actor_user where id=p.id;
  update invoices set status=new_status,paid_amount=new_paid,paid_at=null,next_reminder_at=next_time_value,updated_by=actor_user,updated_at=now() where id=i.id;
  if i.status='paid' then update reminder_log set status='failed',error_message='Bankovní platba byla uvolněna; krok čeká na nové vyhodnocení.',updated_at=now() where invoice_id=i.id and status='skipped' and sent_at is null; end if;
  return jsonb_build_object('payment_id',p.id,'invoice_id',i.id,'invoice_number',i.invoice_number,'status','unmatched','invoice_status',new_status,'paid_amount',new_paid,'remaining',i.amount-new_paid);
end; $$;
revoke all on function unassign_bank_payment(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function unassign_bank_payment(uuid,uuid,uuid) to service_role;

create or replace function reopen_paid_invoice(target_org uuid,target_invoice uuid,actor_user uuid,new_status text,next_time timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare i invoices%rowtype; reopened invoices%rowtype; detached integer:=0;
begin
  if not exists(select 1 from organization_members where organization_id=target_org and user_id=actor_user and role in('accounting','admin')) then raise exception 'insufficient_permission'; end if;
  if new_status not in('pending','overdue') then raise exception 'invalid_reopen_status'; end if;
  select * into i from invoices where id=target_invoice and organization_id=target_org for update;
  if not found then raise exception 'invoice_not_found'; end if; if i.status<>'paid' then raise exception 'invoice_not_paid'; end if;
  update bank_payments set invoice_id=null,match_status='unmatched',matched_at=null,unmatched_at=now(),unmatched_by=actor_user where organization_id=target_org and invoice_id=target_invoice and match_status='matched';
  get diagnostics detached=row_count;
  update invoices set status=new_status,paid_amount=0,paid_at=null,next_reminder_at=next_time,updated_by=actor_user,updated_at=now() where id=target_invoice and organization_id=target_org returning * into reopened;
  update reminder_log set status='failed',error_message='Faktura byla znovu otevřena; krok čeká na nové vyhodnocení.',updated_at=now() where invoice_id=target_invoice and status='skipped' and sent_at is null;
  update invoice_events set details=details||jsonb_build_object('paid_at',i.paid_at,'detached_payments',detached) where id=(select id from invoice_events where invoice_id=target_invoice and event_type='reopened' order by created_at desc limit 1);
  return jsonb_build_object('invoice',to_jsonb(reopened),'detached_payments',detached);
end; $$;
revoke all on function reopen_paid_invoice(uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function reopen_paid_invoice(uuid,uuid,uuid,text,timestamptz) to service_role;

create or replace function import_and_reconcile_bank_payments(target_org uuid,actor_user uuid,payment_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p jsonb; payment_id uuid; candidate_id uuid; candidate_number text; candidate_count integer; remaining numeric;
  imported integer:=0; matched integer:=0; partial integer:=0; unmatched integer:=0; ambiguous integer:=0; duplicates integer:=0; results jsonb:='[]'::jsonb;
begin
  if jsonb_typeof(payment_rows)<>'array' or jsonb_array_length(payment_rows)<1 or jsonb_array_length(payment_rows)>500 then raise exception 'invalid payment batch'; end if;
  if not exists(select 1 from organization_members where organization_id=target_org and user_id=actor_user and role in('accounting','admin')) then raise exception 'insufficient payment import permission'; end if;
  for p in select value from jsonb_array_elements(payment_rows) loop
    payment_id:=null; candidate_id:=null; candidate_number:=null; candidate_count:=0; remaining:=null;
    insert into bank_payments(organization_id,external_id,booked_on,amount,currency,variable_symbol,counterparty_name,counterparty_account,note,imported_by)
    values(target_org,trim(p->>'external_id'),(p->>'booked_on')::date,(p->>'amount')::numeric,upper(p->>'currency'),nullif(trim(p->>'variable_symbol'),''),nullif(trim(p->>'counterparty_name'),''),nullif(trim(p->>'counterparty_account'),''),nullif(trim(p->>'note'),''),actor_user)
    on conflict(organization_id,external_id) do nothing returning id into payment_id;
    if payment_id is null then duplicates:=duplicates+1; results:=results||jsonb_build_array(jsonb_build_object('external_id',p->>'external_id','status','duplicate')); continue; end if;
    imported:=imported+1;
    if nullif(trim(p->>'variable_symbol'),'') is not null then
      select count(*),(array_agg(id order by id))[1],(array_agg(invoice_number order by id))[1] into candidate_count,candidate_id,candidate_number
      from invoices where organization_id=target_org and status in('pending','overdue') and variable_symbol=trim(p->>'variable_symbol')
        and currency=upper(p->>'currency') and (p->>'amount')::numeric<=amount-paid_amount;
    end if;
    if candidate_count=1 then
      select amount-paid_amount into remaining from invoices where id=candidate_id and organization_id=target_org and status in('pending','overdue') for update;
      if remaining is null or (p->>'amount')::numeric>remaining then candidate_count:=0; end if;
    end if;
    if candidate_count=1 then
      update bank_payments set invoice_id=candidate_id,match_status='matched',matched_at=now() where id=payment_id;
      update invoices set paid_amount=paid_amount+(p->>'amount')::numeric,
        status=case when paid_amount+(p->>'amount')::numeric=amount then 'paid' when due_date<(now() at time zone 'Europe/Prague')::date then 'overdue' else 'pending' end,
        paid_at=case when paid_amount+(p->>'amount')::numeric=amount then ((p->>'booked_on')::date+time '12:00') at time zone 'Europe/Prague' else null end,
        next_reminder_at=case when paid_amount+(p->>'amount')::numeric=amount then null else next_reminder_at end,updated_by=actor_user,updated_at=now()
      where id=candidate_id and organization_id=target_org and status in('pending','overdue');
      matched:=matched+1; if (p->>'amount')::numeric<remaining then partial:=partial+1; end if;
      results:=results||jsonb_build_array(jsonb_build_object('external_id',p->>'external_id','status','matched','invoice_id',candidate_id,'invoice_number',candidate_number,'settlement',case when (p->>'amount')::numeric=remaining then 'full' else 'partial' end,'remaining',remaining-(p->>'amount')::numeric));
    elsif candidate_count>1 then update bank_payments set match_status='ambiguous' where id=payment_id; ambiguous:=ambiguous+1; results:=results||jsonb_build_array(jsonb_build_object('external_id',p->>'external_id','status','ambiguous'));
    else unmatched:=unmatched+1; results:=results||jsonb_build_array(jsonb_build_object('external_id',p->>'external_id','status','unmatched')); end if;
  end loop;
  return jsonb_build_object('imported',imported,'matched',matched,'partial_matched',partial,'unmatched',unmatched,'ambiguous',ambiguous,'duplicates',duplicates,'results',results);
end; $$;
revoke all on function import_and_reconcile_bank_payments(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function import_and_reconcile_bank_payments(uuid,uuid,jsonb) to service_role;

create or replace function list_invoices_page(target_org uuid,actor_user uuid,search_query text default null,status_filter text default null,currency_filter text default null,issue_from date default null,issue_to date default null,page_number integer default 1,page_size integer default 25)
returns jsonb language plpgsql security definer set search_path=public as $$ declare result jsonb; begin
  if not exists(select 1 from organization_members where organization_id=target_org and user_id=actor_user) then raise exception 'insufficient_permission'; end if;
  if page_number<1 or page_size<1 or page_size>500 then raise exception 'invalid_pagination'; end if;
  with filtered as materialized(select i.* from invoices i where i.organization_id=target_org and(status_filter is null or i.status=status_filter) and(currency_filter is null or i.currency=currency_filter) and(issue_from is null or i.issue_date>=issue_from) and(issue_to is null or i.issue_date<=issue_to) and(nullif(trim(search_query),'') is null or i.invoice_number ilike '%'||trim(search_query)||'%' or i.counterparty_name ilike '%'||trim(search_query)||'%' or i.counterparty_email ilike '%'||trim(search_query)||'%' or coalesce(i.variable_symbol,'') ilike '%'||trim(search_query)||'%')),
  paged as(select * from filtered order by due_date,id offset(page_number-1)*page_size limit page_size),totals as(select currency,sum(amount-paid_amount) amount from filtered where status in('pending','overdue') group by currency),currencies as(select distinct currency from invoices where organization_id=target_org)
  select jsonb_build_object('invoices',coalesce((select jsonb_agg(to_jsonb(p) order by p.due_date,p.id) from paged p),'[]'::jsonb),'total',(select count(*) from filtered),'open_totals',coalesce((select jsonb_object_agg(currency,amount) from totals),'{}'::jsonb),'currencies',coalesce((select jsonb_agg(currency order by currency) from currencies),'[]'::jsonb),'active_count',(select count(*) from invoices where organization_id=target_org and status in('pending','overdue'))) into result; return result;
end; $$;
revoke all on function list_invoices_page(uuid,uuid,text,text,text,date,date,integer,integer) from public,anon,authenticated;
grant execute on function list_invoices_page(uuid,uuid,text,text,text,date,date,integer,integer) to service_role;

create or replace function invoice_report_rows_page(target_org uuid,actor_user uuid,report_from date,report_to date,date_basis text,currency_filter text,status_filter text default null,customer_filter text default null,page_number integer default 1,page_size integer default 500)
returns jsonb language plpgsql security definer set search_path=public as $$ declare result jsonb; begin
  if not exists(select 1 from organization_members where organization_id=target_org and user_id=actor_user) then raise exception 'insufficient_permission'; end if;
  if report_from>report_to or page_number<1 or page_size<1 or page_size>500 then raise exception 'invalid_request'; end if;
  with filtered as materialized(select i.invoice_number,i.counterparty_name,i.amount,i.paid_amount,i.amount-i.paid_amount remaining_amount,i.currency,i.issue_date,i.due_date,i.paid_at,i.status,i.reminders_sent,i.id from invoices i where i.organization_id=target_org and i.currency=currency_filter and(status_filter is null or i.status=status_filter) and(customer_filter is null or i.counterparty_name=customer_filter) and((date_basis='issue_date' and i.issue_date between report_from and report_to)or(date_basis='due_date' and i.due_date between report_from and report_to)or(date_basis='paid_at' and(i.paid_at at time zone 'Europe/Prague')::date between report_from and report_to))),paged as(select * from filtered order by issue_date,id offset(page_number-1)*page_size limit page_size)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.issue_date,p.id) from paged p),'[]'::jsonb),'total',(select count(*) from filtered)) into result; return result;
end; $$;
revoke all on function invoice_report_rows_page(uuid,uuid,date,date,text,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function invoice_report_rows_page(uuid,uuid,date,date,text,text,text,text,integer,integer) to service_role;

create or replace function invoice_report_summary(target_org uuid,actor_user uuid,report_from date,report_to date,date_basis text,currency_filter text,status_filter text default null,customer_filter text default null,as_of_date date default current_date)
returns jsonb language plpgsql security definer set search_path=public as $$ declare result jsonb; begin
  if not exists(select 1 from organization_members where organization_id=target_org and user_id=actor_user) then raise exception 'insufficient_permission'; end if;
  if report_from>report_to then raise exception 'invalid_period'; end if;
  with filtered as materialized(select i.* from invoices i where i.organization_id=target_org and i.currency=currency_filter and(status_filter is null or i.status=status_filter) and(customer_filter is null or i.counterparty_name=customer_filter) and((date_basis='issue_date' and i.issue_date between report_from and report_to)or(date_basis='due_date' and i.due_date between report_from and report_to)or(date_basis='paid_at' and(i.paid_at at time zone 'Europe/Prague')::date between report_from and report_to))),
  aging as(select case when as_of_date-due_date<=0 then 0 when as_of_date-due_date<=7 then 1 when as_of_date-due_date<=14 then 2 when as_of_date-due_date<=30 then 3 else 4 end bucket,sum(amount-paid_amount) amount,count(*) count from filtered where status in('pending','overdue') group by 1),
  monthly as(select to_char(issue_date,'YYYY-MM') key,sum(amount) issued,sum(paid_amount) paid from filtered group by 1),
  debtors as(select counterparty_name name,sum(amount-paid_amount) open,coalesce(sum(amount-paid_amount)filter(where status='overdue'),0) overdue,count(*) count,sum(reminders_sent) reminders from filtered where status in('pending','overdue') group by counterparty_name)
  select jsonb_build_object(
    'invoice_count',(select count(*)from filtered),'total',coalesce((select sum(amount)from filtered),0),
    'paid',coalesce((select sum(paid_amount)from filtered where status<>'cancelled'),0),
    'overdue',coalesce((select sum(amount-paid_amount)from filtered where status='overdue'),0),
    'open',coalesce((select sum(amount-paid_amount)from filtered where status in('pending','overdue')),0),
    'paid_rate',coalesce((select round(100*coalesce(sum(paid_amount)filter(where status<>'cancelled'),0)/nullif(coalesce(sum(amount)filter(where status<>'cancelled'),0),0))from filtered),0)::integer,
    'counts',jsonb_build_object('pending',(select count(*)from filtered where status='pending'),'overdue',(select count(*)from filtered where status='overdue'),'paid',(select count(*)from filtered where status='paid'),'cancelled',(select count(*)from filtered where status='cancelled')),
    'aging',coalesce((select jsonb_agg(jsonb_build_object('label',case g.bucket when 0 then 'Před splatností' when 1 then '1–7 dní' when 2 then '8–14 dní' when 3 then '15–30 dní' else 'Více než 30 dní' end,'amount',coalesce(a.amount,0),'count',coalesce(a.count,0))order by g.bucket)from generate_series(0,4)g(bucket)left join aging a using(bucket)),'[]'::jsonb),
    'monthly',coalesce((select jsonb_agg(jsonb_build_object('key',key,'issued',issued,'paid',paid)order by key)from monthly),'[]'::jsonb),
    'debtors',coalesce((select jsonb_agg(jsonb_build_object('name',name,'open',open,'overdue',overdue,'count',count,'reminders',reminders)order by open desc,name)from debtors),'[]'::jsonb),
    'currencies',coalesce((select jsonb_agg(currency order by currency)from(select distinct currency from invoices where organization_id=target_org)c),'[]'::jsonb),
    'customers',coalesce((select jsonb_agg(counterparty_name order by counterparty_name)from(select distinct counterparty_name from invoices where organization_id=target_org)n),'[]'::jsonb)) into result; return result;
end; $$;
revoke all on function invoice_report_summary(uuid,uuid,date,date,text,text,text,text,date) from public,anon,authenticated;
grant execute on function invoice_report_summary(uuid,uuid,date,date,text,text,text,text,date) to service_role;

create or replace function dashboard_summary(target_org uuid,actor_user uuid) returns jsonb language plpgsql security definer set search_path=public as $$ declare result jsonb; begin
  if not exists(select 1 from organization_members where organization_id=target_org and user_id=actor_user) then raise exception 'insufficient_permission'; end if;
  with totals as(select currency,coalesce(sum(amount-paid_amount)filter(where status in('pending','overdue')),0) open_amount,coalesce(sum(amount-paid_amount)filter(where status='overdue'),0) overdue_amount,coalesce(sum(paid_amount)filter(where status<>'cancelled'),0) received from invoices where organization_id=target_org group by currency),recent as(select id,invoice_number,variable_symbol,counterparty_name,counterparty_email,amount,paid_amount,currency,due_date,status,reminders_sent,created_at from invoices where organization_id=target_org order by created_at desc,id desc limit 5),upcoming as(select id,invoice_number,counterparty_name,amount,paid_amount,currency,status,next_reminder_at from invoices where organization_id=target_org and status in('pending','overdue') and next_reminder_at is not null order by next_reminder_at,id limit 4)
  select jsonb_build_object('open_totals',coalesce((select jsonb_object_agg(currency,open_amount)from totals where open_amount>0),'{}'::jsonb),'overdue_totals',coalesce((select jsonb_object_agg(currency,overdue_amount)from totals where overdue_amount>0),'{}'::jsonb),'paid_totals',coalesce((select jsonb_object_agg(currency,received)from totals where received>0),'{}'::jsonb),'active_count',(select count(*)from invoices where organization_id=target_org and status in('pending','overdue')),'overdue_count',(select count(*)from invoices where organization_id=target_org and status='overdue'),'reminders_sent',coalesce((select sum(reminders_sent)from invoices where organization_id=target_org),0),'recent',coalesce((select jsonb_agg(to_jsonb(r)order by r.created_at desc,r.id desc)from recent r),'[]'::jsonb),'upcoming',coalesce((select jsonb_agg(to_jsonb(u)order by u.next_reminder_at,u.id)from upcoming u),'[]'::jsonb)) into result; return result;
end; $$;
revoke all on function dashboard_summary(uuid,uuid) from public,anon,authenticated;
grant execute on function dashboard_summary(uuid,uuid) to service_role;
