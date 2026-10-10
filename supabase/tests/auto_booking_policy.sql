\set ON_ERROR_STOP on
-- Automatické zaúčtování po firmách (organizations.auto_booking):
--   'vs'          (nové firmy) jen při shodě VS / čísla faktury a částky,
--   'vs_and_name' (R. Hlavica) i podle jména plátce a částky,
--   'off'         nic bez člověka.
-- A výpis z jiného než firemního účtu (account_mismatch) automaticky nic
-- nezaúčtuje, dokud ho člověk nepotvrdí.
begin;
do $$
declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid();
  by_name uuid:=gen_random_uuid(); by_vs uuid:=gen_random_uuid(); statement uuid; response jsonb; result jsonb; rows jsonb;
begin
  insert into auth.users(id,email) values(actor,'auto-booking@novafirma.cz');
  insert into public.organizations(id,name,ico) values(org,'Nová firma','27082440');
  insert into public.subscriptions(organization_id,status,plan,period,billing_exempt) values(org,'active','business','yearly',true);
  insert into public.organization_members(organization_id,user_id,email,role) values(org,actor,'auto-booking@novafirma.cz','admin');
  if (select auto_booking from public.organizations where id=org)<>'vs' then
    raise exception 'New company must start with VS-only automatic booking';
  end if;

  insert into public.invoices(id,organization_id,invoice_number,counterparty_name,counterparty_email,
    amount_without_vat,vat_rate,amount,currency,issue_date,due_date,variable_symbol,created_by)
  values(by_name,org,'FV-1','Novák Stavby s.r.o.','n@example.cz',500,0,500,'CZK',current_date-1,current_date,'111',actor),
        (by_vs,org,'FV-2','Jiná firma s.r.o.','j@example.cz',700,0,700,'CZK',current_date-1,current_date,'222',actor);

  rows:=jsonb_build_array(
    jsonb_build_object('line_number',1,'record_type','075','fingerprint',repeat('a',64),
      'disposition','accepted','external_id','name-only','booked_on',current_date,'amount',500,'currency','CZK',
      'counterparty_name','NOVAK STAVBY S.R.O.','proposal_kind','exact','proposal_confidence','safe','proposal_reason','jméno',
      'proposed_invoice_ids',jsonb_build_array(by_name)));

  -- 1) Nová firma ('vs'): shoda jména a částky bez VS se automaticky nezaúčtuje.
  response:=public.create_bank_statement_preview(org,actor,jsonb_build_object('source_format','gpc','original_filename','a.gpc',
    'file_hash',repeat('1',64),'accepted_count',1,'automation_mode','automatic'),rows);
  statement:=(response->>'id')::uuid;
  result:=public.reconcile_bank_statement(org,actor,statement,(response->>'revision')::int,true,false);
  if (select paid_amount from public.invoices where id=by_name)<>0 then
    raise exception 'VS-only company booked a payment by payer name: %', result;
  end if;

  -- 2) Firma s 'vs_and_name' (R. Hlavica) ji zaúčtuje.
  update public.organizations set auto_booking='vs_and_name' where id=org;
  response:=public.create_bank_statement_preview(org,actor,jsonb_build_object('source_format','gpc','original_filename','b.gpc',
    'file_hash',repeat('2',64),'accepted_count',1,'automation_mode','automatic'),
    jsonb_set(rows,'{0,external_id}','"name-only-2"'));
  statement:=(response->>'id')::uuid;
  result:=public.reconcile_bank_statement(org,actor,statement,(response->>'revision')::int,true,false);
  if (select paid_amount from public.invoices where id=by_name)<>500 then
    raise exception 'Name-and-amount company did not book by payer name: %', result;
  end if;

  -- 3) Výpis z cizího účtu: ani shoda VS se automaticky nezaúčtuje.
  update public.organizations set auto_booking='vs' where id=org;
  response:=public.create_bank_statement_preview(org,actor,jsonb_build_object('source_format','gpc','original_filename','c.gpc',
    'file_hash',repeat('3',64),'accepted_count',1,'automation_mode','automatic','account_mismatch',true,'statement_account','19-2000145399/0800'),
    jsonb_build_array(jsonb_build_object('line_number',1,'record_type','075','fingerprint',repeat('c',64),
      'disposition','accepted','external_id','vs-foreign','booked_on',current_date,'amount',700,'currency','CZK',
      'variable_symbol','222','proposal_kind','exact','proposal_confidence','safe','proposal_reason','VS',
      'proposed_invoice_ids',jsonb_build_array(by_vs))));
  statement:=(response->>'id')::uuid;
  result:=public.reconcile_bank_statement(org,actor,statement,(response->>'revision')::int,true,false);
  if (select paid_amount from public.invoices where id=by_vs)<>0 then
    raise exception 'Statement from a foreign account was booked automatically: %', result;
  end if;
  -- Člověk neshodu potvrdí a zaúčtuje.
  result:=public.reconcile_bank_statement(org,actor,statement,(result->>'revision')::int,false,true);
  if (select paid_amount from public.invoices where id=by_vs)<>700 then
    raise exception 'Acknowledged statement was not booked by a person: %', result;
  end if;

  -- 4) 'off': nic automaticky, ani shoda VS.
  insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,
    amount_without_vat,vat_rate,amount,currency,issue_date,due_date,variable_symbol,created_by)
  values(org,'FV-3','Třetí s.r.o.','t@example.cz',900,0,900,'CZK',current_date-1,current_date,'333',actor);
  update public.organizations set auto_booking='off' where id=org;
  response:=public.create_bank_statement_preview(org,actor,jsonb_build_object('source_format','gpc','original_filename','d.gpc',
    'file_hash',repeat('4',64),'accepted_count',1,'automation_mode','automatic'),
    jsonb_build_array(jsonb_build_object('line_number',1,'record_type','075','fingerprint',repeat('d',64),
      'disposition','accepted','external_id','vs-off','booked_on',current_date,'amount',900,'currency','CZK',
      'variable_symbol','333','proposal_kind','exact','proposal_confidence','safe','proposal_reason','VS',
      'proposed_invoice_ids',jsonb_build_array((select id from public.invoices where invoice_number='FV-3' and organization_id=org)))));
  statement:=(response->>'id')::uuid;
  result:=public.reconcile_bank_statement(org,actor,statement,(response->>'revision')::int,true,false);
  if (select paid_amount from public.invoices where invoice_number='FV-3' and organization_id=org)<>0 then
    raise exception 'Company with automatic booking off got a payment booked: %', result;
  end if;

  -- 5) Číslo faktury s oddělovači ve zprávě (bez nich) se automaticky zaúčtuje.
  update public.organizations set auto_booking='vs' where id=org;
  insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,
    amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by)
  values(org,'FV-2026/001','Čtvrtá s.r.o.','c@example.cz',450,0,450,'CZK',current_date-1,current_date,actor);
  response:=public.create_bank_statement_preview(org,actor,jsonb_build_object('source_format','gpc','original_filename','e.gpc',
    'file_hash',repeat('5',64),'accepted_count',1,'automation_mode','automatic'),
    jsonb_build_array(jsonb_build_object('line_number',1,'record_type','075','fingerprint',repeat('e',64),
      'disposition','accepted','external_id','ref-sep','booked_on',current_date,'amount',450,'currency','CZK',
      'note','Uhrada FV2026001','proposal_kind','exact','proposal_confidence','safe','proposal_reason','zpráva',
      'proposed_invoice_ids',jsonb_build_array((select id from public.invoices where invoice_number='FV-2026/001' and organization_id=org)))));
  statement:=(response->>'id')::uuid;
  result:=public.reconcile_bank_statement(org,actor,statement,(response->>'revision')::int,true,false);
  if (select paid_amount from public.invoices where invoice_number='FV-2026/001' and organization_id=org)<>450 then
    raise exception 'Invoice number with separators referenced in the message was not booked: %', result;
  end if;
  if private.message_references_invoice('doklad XFV-2026/0011', 'FV-2026/001') then
    raise exception 'Invoice number matched inside a longer token';
  end if;

  -- 6) Režim firmy nemění přihlášený uživatel.
  if has_column_privilege('authenticated','public.organizations','auto_booking','UPDATE') then
    raise exception 'authenticated may change auto_booking';
  end if;
end $$;
rollback;
