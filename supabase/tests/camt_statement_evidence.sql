\set ON_ERROR_STOP on
begin;
do $$
declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); result jsonb; statement uuid; entry uuid; response jsonb; rows jsonb;
begin
  insert into auth.users(id,email) values(actor,'camt-test@hlavica.cz');
  insert into public.organizations(id,name,ico) values(org,'CAMT test','12345678');
  insert into public.organization_members(organization_id,user_id,email,role) values(org,actor,'camt-test@hlavica.cz','admin');
  rows:=jsonb_build_array(jsonb_build_object('line_number',1,'record_type','075','fingerprint',repeat('d',64),'disposition','accepted','external_id','gpc-cross-test',
    'booked_on',current_date,'amount',100,'currency','CZK','counterparty_account','19-2000145399/0800','counterparty_name','Customer'));
  result:=public.create_bank_statement_preview(org,actor,jsonb_build_object('source_format','gpc','original_filename','original.gpc','file_hash',repeat('d',64),
    'statement_account','19-2000145399/0800','accepted_count',1),rows);
  perform public.reconcile_bank_statement(org,actor,(result->>'id')::uuid,1,false,false);
  rows:=jsonb_build_array(jsonb_build_object('line_number',1,'record_type','camt053','fingerprint',repeat('e',64),'disposition','accepted','external_id','camt-cross-test',
    'booked_on',current_date,'amount',100,'currency','CZK','counterparty_account','CZ6508000000192000145399','counterparty_name','Customer','bank_reference','KB-PID-1',
    'proposal_kind','exact','proposal_confidence','safe','proposed_invoice_ids','[]'::jsonb,'provenance',jsonb_build_object('namespace','camt.053.001.02')));
  result:=public.create_camt_statement_preview(org,actor,jsonb_build_object('source_format','camt053','original_filename','richer.xml','file_hash',repeat('e',64),
    'statement_account','CZ6508000000192000145399','automation_mode','automatic'),rows);
  statement:=(result->>'id')::uuid;
  select id into entry from public.bank_statement_entries where import_id=statement;
  if not (select overlap_warning from public.bank_statement_entries where id=entry) then raise exception 'Cross-format overlap not flagged'; end if;
  if (select automation_mode from public.bank_statement_imports where id=statement)<>'shadow' then raise exception 'CAMT allowed automatic booking'; end if;
  response:=public.reconcile_bank_statement(org,actor,statement,1,false,false);
  if response->'errors'->0->>'code'<>'possible_duplicate' then raise exception 'Overlap booked without acknowledgement: %',response; end if;
  if (select count(*) from public.bank_payments where organization_id=org)<>1 then raise exception 'Overlap double-booked'; end if;
  perform public.acknowledge_statement_overlap(org,actor,entry,2);
  response:=public.reconcile_bank_statement(org,actor,statement,3,false,false);
  if (response->>'imported')::integer<>1 then raise exception 'Explicit acknowledgement not accepted: %',response; end if;
  result:=public.create_camt_statement_preview(org,actor,jsonb_build_object('source_format','camt053','original_filename','overlapping.xml','file_hash',repeat('f',64),
    'statement_account','19-2000145399/0800'),rows);
  if (result->'totals'->>'accepted')::integer<>0 then raise exception 'Repeated bank reference not deduplicated'; end if;
  if not exists(select 1 from public.bank_statement_entries where import_id=(result->>'id')::uuid and disposition='duplicate') then raise exception 'Duplicate reference missing'; end if;
  if (select count(*) from public.bank_payments where organization_id=org)<>2 then raise exception 'Reference duplicate affected ledger'; end if;
end $$;
rollback;
