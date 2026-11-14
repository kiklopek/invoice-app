begin;
do $$
declare
  org_a uuid:=gen_random_uuid(); org_b uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid();
  invoice_a uuid:=gen_random_uuid(); invoice_b uuid:=gen_random_uuid(); payment_a uuid:=gen_random_uuid(); payment_b uuid:=gen_random_uuid(); result jsonb;
begin
  insert into auth.users(id,email) values(actor,'api-payments@example.com');
  insert into public.organizations(id,name,ico) values(org_a,'Payments A','12345678'),(org_b,'Payments B','87654321');
  insert into public.organization_members(organization_id,user_id,email,role) values(org_a,actor,'api-payments@example.com','admin');
  insert into public.subscriptions(organization_id,status,billing_exempt) values(org_a,'active',true);
  insert into public.invoices(id,organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by)
    values(invoice_a,org_a,'API-P1','Buyer','buyer@example.com',100,21,121,'CZK',current_date,current_date,actor),
      (invoice_b,org_a,'API-P2','Buyer','buyer@example.com',200,21,242,'CZK',current_date,current_date,actor);
  insert into public.bank_payments(id,organization_id,external_id,booked_on,amount,currency,match_status,created_at,matched_at)
    values(payment_a,org_a,'api-split',current_date,300,'CZK','split','2026-11-14T10:00:00Z',now()),(payment_b,org_a,'api-open',current_date,20,'CZK','unmatched','2026-11-14T10:01:00Z',null);
  insert into public.bank_payments(organization_id,external_id,booked_on,amount,currency,match_status)
    values(org_b,'api-foreign',current_date,50,'CZK','unmatched');
  insert into public.bank_payment_allocations(organization_id,bank_payment_id,invoice_id,amount,is_committed,created_by)
    values(org_a,payment_a,invoice_a,100,true,actor),(org_a,payment_a,invoice_b,200,true,actor),(org_a,payment_a,invoice_a,1,false,actor);
  set local role service_role;
  result:=public.list_api_payments_page(org_a,actor,invoice_b,null,null,50);
  if jsonb_array_length(result)<>1 or result->0->>'id'<>payment_a::text then raise exception 'split payment missing from invoice filter'; end if;
  if jsonb_array_length(result->0->'allocations')<>2 then raise exception 'committed allocations incomplete or draft included'; end if;
  if (result->0->>'allocated_amount')::numeric<>300 or (result->0->>'unallocated_amount')::numeric<>0 or result->0->>'allocation_status'<>'allocated' then raise exception 'allocation balance incorrect'; end if;
  if result->0 ? 'counterparty_account' or result->0 ? 'note' or result->0 ? 'organization_id' then raise exception 'private payment field exposed'; end if;
  result:=public.list_api_payments_page(org_a,actor,null,null,null,1);
  if jsonb_array_length(result)<>2 then raise exception 'bounded lookahead page incorrect'; end if;
  result:=public.list_api_payments_page(org_a,actor,null,'2026-11-14T10:00:00Z',payment_a,1);
  if jsonb_array_length(result)<>1 or result->0->>'id'<>payment_b::text then raise exception 'cursor skipped/repeated payment'; end if;
  if jsonb_array_length(public.list_api_payments_page(org_a,actor,gen_random_uuid(),null,null,50))<>0 then raise exception 'foreign invoice filter revealed data'; end if;
  begin perform public.list_api_payments_page(org_b,actor,null,null,null,50); raise exception 'foreign actor accepted'; exception when insufficient_privilege then null; end;
  if has_function_privilege('anon','public.list_api_payments_page(uuid,uuid,uuid,timestamptz,uuid,integer)','EXECUTE') or has_function_privilege('authenticated','public.list_api_payments_page(uuid,uuid,uuid,timestamptz,uuid,integer)','EXECUTE') then raise exception 'public payment RPC exposed'; end if;
end $$;
rollback;
