-- Disposable database only. No changes persist after rollback.
begin;
do $$
declare
  org uuid := gen_random_uuid(); actor uuid := gen_random_uuid(); failed text;
  invoice_id uuid; used integer; month_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
begin
  insert into auth.users(id,email) values(actor,'usage@example.invalid');
  insert into public.organizations(id,name,ico) values(org,'Usage fixture','27082440');
  insert into public.organization_members(organization_id,user_id,email,role) values(org,actor,'usage@example.invalid','admin');
  insert into public.subscriptions(organization_id,status,plan,period,invoice_month_start,invoice_month_used)
    values(org,'active','start','monthly',month_start,99);
  insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,status,created_by)
    values(org,'USAGE-1','Customer','x@example.invalid',100,0,100,'CZK',current_date,current_date,'pending',actor) returning id into invoice_id;
  delete from public.invoices where id=invoice_id;
  select invoice_month_used into used from public.subscriptions where organization_id=org;
  if used <> 100 then raise exception 'Deletion refunded usage: %',used; end if;
  begin
    insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,status,created_by)
      values(org,'USAGE-2','Customer','x@example.invalid',100,0,100,'CZK',current_date,current_date,'pending',actor);
    raise exception 'expected monthly_invoice_limit';
  exception when others then failed:=sqlerrm; end;
  if failed <> 'monthly_invoice_limit' then raise exception 'Start limit not enforced: %',failed; end if;
  update public.subscriptions set plan='profi', invoice_month_used=499 where organization_id=org;
  insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,status,created_by)
    values(org,'USAGE-3','Customer','x@example.invalid',100,0,100,'CZK',current_date,current_date,'pending',actor);
  begin
    insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,status,created_by)
      values(org,'USAGE-4','Customer','x@example.invalid',100,0,100,'CZK',current_date,current_date,'pending',actor);
    raise exception 'expected monthly_invoice_limit';
  exception when others then failed:=sqlerrm; end;
  if failed <> 'monthly_invoice_limit' then raise exception 'Profi limit not enforced: %',failed; end if;
  update public.subscriptions set invoice_month_start=month_start-interval '1 month' where organization_id=org;
  insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,status,created_by)
    values(org,'USAGE-5','Customer','x@example.invalid',100,0,100,'CZK',current_date,current_date,'pending',actor);
  select invoice_month_used into used from public.subscriptions where organization_id=org;
  if used <> 1 then raise exception 'Month did not reset: %',used; end if;
  update public.subscriptions set plan='business',invoice_month_used=9000 where organization_id=org;
  insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,status,created_by)
    values(org,'USAGE-6','Customer','x@example.invalid',100,0,100,'CZK',current_date,current_date,'pending',actor);
  update public.subscriptions set plan='start',billing_exempt=true,invoice_month_used=9000 where organization_id=org;
  insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,status,created_by)
    values(org,'USAGE-7','Customer','x@example.invalid',100,0,100,'CZK',current_date,current_date,'pending',actor);
end $$;
rollback;
