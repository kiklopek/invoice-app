\set ON_ERROR_STOP on
begin;
do $$
declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); invoice_id uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email) values(actor,'invoice-total-test@hlavica.cz');
  insert into public.organizations(id,name,ico) values(org,'Invoice total test','12345678');
  -- Fixture: firmy mají trvalý přístup (bez řádku předplatného se nefakturuje).
  insert into public.subscriptions(organization_id, status, plan, period, billing_exempt)
    select o.id, 'active', 'business', 'yearly', true from public.organizations o
    where not exists (select 1 from public.subscriptions s where s.organization_id = o.id);
  insert into public.organization_members(organization_id,user_id,email,role)
    values(org,actor,'invoice-total-test@hlavica.cz','admin');
  -- The screenshot's total is accepted without evidence or a confirmation.
  insert into public.invoices(id,organization_id,invoice_number,counterparty_name,counterparty_email,
    amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by)
  values(invoice_id,org,'TOTAL','Test','test@example.cz',10250.5,21,12403,'CZK',current_date,current_date,actor);
  if (select amount from public.invoices where id=invoice_id)<>12403 then
    raise exception 'Document total changed';
  end if;
  -- Large differences and edits are also accepted without an explanation.
  update public.invoices set amount=12000,updated_by=actor where id=invoice_id;
  if (select amount from public.invoices where id=invoice_id)<>12000 then
    raise exception 'Edited total changed';
  end if;
  insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,
    amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by,money_evidence)
  values(org,'EVIDENCE','Test','test@example.cz',10250.5,21,12403,'CZK',current_date,current_date,actor,
    '{"original_total":12403,"total_source":"read","adjustment":0,"adjustment_reason":"","adjustment_confirmed":false,"initial_paid":0,"initial_paid_confirmed":false,"multi_rate":true}');
end $$;
rollback;
