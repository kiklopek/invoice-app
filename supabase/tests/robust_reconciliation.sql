\set ON_ERROR_STOP on
begin;
-- Run against a local database with the migration applied. All fixtures roll back.
do $$
declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); invoice_id uuid:=gen_random_uuid();
  statement uuid; response jsonb; result jsonb; rows jsonb; paid numeric;
begin
  insert into auth.users(id,email) values(actor,'reconciliation-test@hlavica.cz');
  insert into public.organizations(id,name) values(org,'Reconciliation test');
  insert into public.organization_members(organization_id,user_id,email,role) values(org,actor,'reconciliation-test@hlavica.cz','admin');
  insert into public.invoices(id,organization_id,invoice_number,counterparty_name,counterparty_email,
    amount_without_vat,vat_rate,amount,currency,issue_date,due_date,variable_symbol,created_by,money_evidence)
  values(invoice_id,org,'260610','Test','test@example.cz',12942,21,15660,'CZK',current_date,current_date,'260610',actor,
    '{"original_total":15660,"total_source":"read","adjustment":0.18,"adjustment_reason":"Zaokrouhlení dokumentu","adjustment_confirmed":true,"initial_paid":0,"initial_paid_confirmed":false}');
  rows:=jsonb_build_array(jsonb_build_object('line_number',1,'record_type','075','fingerprint',repeat('a',64),
    'disposition','accepted','external_id','test-one','booked_on',current_date,'amount',15660,'currency','CZK',
    'variable_symbol','260610','proposal_kind','exact','proposal_confidence','safe','proposed_invoice_ids',jsonb_build_array(invoice_id)));
  response:=public.create_bank_statement_preview(org,actor,jsonb_build_object('source_format','gpc','original_filename','test.gpc',
    'file_hash',repeat('b',64),'accepted_count',1),rows);
  statement:=(response->>'id')::uuid;
  result:=public.reconcile_bank_statement(org,actor,statement,1,true,false);
  if result->>'status'<>'shadow' then raise exception 'Shadow mode wrote payments'; end if;
  select paid_amount into paid from public.invoices where id=invoice_id;
  if paid<>0 then raise exception 'Shadow changed balance'; end if;
  result:=public.reconcile_bank_statement(org,actor,statement,1,false,false);
  if result->>'status'<>'committed' then raise exception 'Commit failed: %',result; end if;
  select paid_amount into paid from public.invoices where id=invoice_id;
  if paid<>15660 then raise exception 'Incorrect balance %',paid; end if;
  result:=public.reconcile_bank_statement(org,actor,statement,1,false,false);
  if (result->>'idempotent')::boolean is not true then raise exception 'Retry not idempotent'; end if;
  if (select count(*) from public.bank_payments where organization_id=org)<>1 then raise exception 'Duplicate payment'; end if;
  response:=public.create_bank_statement_preview(org,actor,jsonb_build_object('source_format','gpc','original_filename','overlap.gpc',
    'file_hash',repeat('c',64),'accepted_count',1),rows);
  if (response->'totals'->>'accepted')::integer<>0 then raise exception 'Duplicate totals incorrect'; end if;
  if exists(select 1 from public.audit_invoice_money(org) where ledger_paid<>paid_amount) then raise exception 'Ledger mismatch'; end if;
end $$;
rollback;
