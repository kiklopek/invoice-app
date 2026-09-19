\set ON_ERROR_STOP on
begin;
do $$
declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); first_id uuid:=gen_random_uuid();
  second_id uuid:=gen_random_uuid(); initial_id uuid:=gen_random_uuid(); ocr_id uuid:=gen_random_uuid(); statement uuid;
  response jsonb; result jsonb; rows jsonb; failed boolean:=false;
begin
  insert into auth.users(id,email) values(actor,'integrity-test@hlavica.cz');
  insert into public.organizations(id,name) values(org,'Integrity test');
  insert into public.organization_members(organization_id,user_id,email,role) values(org,actor,'integrity-test@hlavica.cz','admin');
  insert into public.invoices(id,organization_id,invoice_number,counterparty_name,counterparty_email,
    amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by,money_evidence)
  values(initial_id,org,'INITIAL','Initial','test@example.cz',100,0,100,'CZK',current_date,current_date,actor,
    '{"original_total":100,"total_source":"read","adjustment":0,"adjustment_reason":"","adjustment_confirmed":false,"initial_paid":100,"initial_paid_confirmed":true}');
  if not exists(select 1 from public.invoices where id=initial_id and status='paid' and paid_at is not null and paid_amount=100)
    then raise exception 'Full initial payment did not settle invoice'; end if;
  begin
    update public.invoices set money_evidence=null where id=initial_id;
  exception when others then
    if sqlerrm<>'initial_payment_requires_ledger_correction' then raise; end if;
    failed:=true;
  end;
  if not failed then raise exception 'Initial payment evidence was erased'; end if;

  insert into public.invoice_uploads(organization_id,path,original_name,expected_mime,expected_size,created_by,expires_at,ocr_money_snapshot)
  values(org,org||'/source.pdf','source.pdf','application/pdf',100,actor,now()+interval '1 day',
    '{"original_total":15660,"total_source":"read","initial_paid":0}');
  insert into public.invoices(id,organization_id,invoice_number,counterparty_name,counterparty_email,
    amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by,file_url,money_evidence)
  values(ocr_id,org,'OCR','OCR Test','test@example.cz',12942,21,15660,'CZK',current_date,current_date,actor,org||'/source.pdf',
    '{"original_total":1,"total_source":"manual","adjustment_reason":"Document rounding","adjustment_confirmed":true,"initial_paid":0}');
  if (select money_evidence->>'original_total' from public.invoices where id=ocr_id)<>'15660' then
    raise exception 'Browser replaced original OCR evidence'; end if;
  failed:=false;
  begin
    update public.invoices set money_evidence=jsonb_set(money_evidence,'{original_total}','1') where id=ocr_id;
  exception when others then
    if sqlerrm<>'original_amount_is_immutable' then raise; end if;
    failed:=true;
  end;
  if not failed then raise exception 'Original evidence was rewritten'; end if;
  update public.invoices set amount=15661,updated_by=actor where id=ocr_id;
  if not exists(select 1 from public.invoice_money_events where invoice_id=ocr_id and before_value->>'amount'='15660.00'
    and after_value->>'amount'='15661.00') then raise exception 'Amount correction audit missing'; end if;

  insert into public.invoices(id,organization_id,invoice_number,counterparty_name,counterparty_email,
    amount_without_vat,vat_rate,amount,currency,issue_date,due_date,variable_symbol,created_by)
  values(first_id,org,'9001','Unique Company','test@example.cz',200,0,200,'CZK',current_date,current_date,'9001',actor),
    (second_id,org,'9002','Another Company','test@example.cz',300,0,300,'CZK',current_date,current_date,'9002',actor);
  rows:=jsonb_build_array(
    jsonb_build_object('line_number',1,'record_type','075','fingerprint',repeat('d',64),
      'disposition','accepted','external_id','guard-one','booked_on',current_date,'amount',200,'currency','CZK',
      'variable_symbol','9001','proposal_kind','exact','proposal_confidence','safe','proposal_reason','VS',
      'proposed_invoice_ids',jsonb_build_array(first_id)),
    jsonb_build_object('line_number',2,'record_type','075','fingerprint',repeat('e',64),
      'disposition','accepted','external_id','guard-two','booked_on',current_date,'amount',300,'currency','CZK',
      'variable_symbol','9002','proposal_kind','exact','proposal_confidence','safe','proposal_reason','VS',
      'proposed_invoice_ids',jsonb_build_array(second_id)));
  response:=public.create_bank_statement_preview(org,actor,jsonb_build_object('source_format','gpc','original_filename','guard.gpc',
    'file_hash',repeat('f',64),'accepted_count',2,'automation_mode','automatic'),rows);
  statement:=(response->>'id')::uuid;
  -- Another invoice sharing the VS appears AFTER preview, with a different amount.
  insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,
    amount_without_vat,vat_rate,amount,currency,issue_date,due_date,variable_symbol,created_by)
  values(org,'9003','Other','test@example.cz',999,0,999,'CZK',current_date,current_date,'9001',actor);
  result:=public.reconcile_bank_statement(org,actor,statement,1,true,false);
  if (result->>'imported')::int<>1 or jsonb_array_length(result->'errors')<>1 then
    raise exception 'Independent progress or ambiguity guard failed: %',result; end if;
  if (select paid_amount from public.invoices where id=first_id)<>0 then raise exception 'Stale proposal booked'; end if;
  if (select paid_amount from public.invoices where id=second_id)<>300 then raise exception 'Independent entry rolled back'; end if;
  result:=public.reconcile_bank_statement(org,actor,statement,2,true,false);
  if (result->>'imported')::int<>0 then raise exception 'Worker retry duplicated a payment'; end if;
  if exists(select 1 from public.audit_invoice_money(org) where ledger_paid<>paid_amount) then raise exception 'Ledger mismatch'; end if;
end $$;
rollback;
