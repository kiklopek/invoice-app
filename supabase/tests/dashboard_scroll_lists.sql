\set ON_ERROR_STOP on
begin;
do $$
declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); result jsonb;
begin
  insert into auth.users(id,email) values(actor,'dashboard-scroll@hlavica.cz');
  insert into public.organizations(id,name) values(org,'Dashboard scroll test');
  insert into public.organization_members(organization_id,user_id,email,role)
    values(org,actor,'dashboard-scroll@hlavica.cz','admin');
  insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,
    amount_without_vat,vat_rate,amount,currency,issue_date,due_date,status,next_reminder_at,created_by,created_at)
  select org,'SCROLL-'||n,'Test','test@example.cz',100,0,100,'CZK',current_date,current_date,
    'pending',now()+(n||' minutes')::interval,actor,now()+(n||' minutes')::interval
  from generate_series(1,60) n;
  result:=public.dashboard_summary(org,actor);
  if jsonb_array_length(result->'recent')<>50 then raise exception 'Recent limit is not 50'; end if;
  if jsonb_array_length(result->'upcoming')<>50 then raise exception 'Upcoming limit is not 50'; end if;
  if result->>'active_count'<>'60' then raise exception 'Summary counters were truncated'; end if;
end $$;
rollback;
