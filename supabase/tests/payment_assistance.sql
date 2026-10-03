\set ON_ERROR_STOP on
begin;
do $$
declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); other_actor uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid();
  inv uuid:=gen_random_uuid(); p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); prop uuid; snapshot jsonb; proposal jsonb; claim jsonb; response jsonb; mem uuid;
begin
  insert into auth.users(id,email) values(actor,'assistance@hlavica.cz'),(other_actor,'other-assistance@hlavica.cz');
  insert into public.organizations(id,name,ico) values(org,'Assistance','12345678'),(other_org,'Other','87654321');
  insert into public.organization_members(organization_id,user_id,email,role) values(org,actor,'assistance@hlavica.cz','admin'),(other_org,other_actor,'other-assistance@hlavica.cz','admin');
  insert into public.invoices(id,organization_id,invoice_number,counterparty_name,counterparty_ico,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by)
    values(inv,org,'1001','Customer','12345678','customer@example.cz',100,0,100,'CZK',current_date,current_date,actor);
  insert into public.bank_payments(id,organization_id,external_id,booked_on,amount,currency,variable_symbol,counterparty_account,imported_by)
    values(p1,org,'instalment-one',current_date,40,'CZK','1001','123/0100',actor),(p2,org,'instalment-two',current_date,60,'CZK','1001','123/0100',actor);
  if exists(select 1 from public.payment_assistance_jobs where organization_id=org) then raise exception 'Disabled feature enqueued'; end if;
  perform public.configure_payment_assistance(org,'shadow',true,true);
  snapshot:=public.payment_assistance_inputs(org);
  proposal:=jsonb_build_object('kind','unique','engine_version','assistance-v1','input_hash',repeat('a',64),'currency','CZK',
    'payment_ids',jsonb_build_array(p1,p2),'invoice_ids',jsonb_build_array(inv),'memory_ids','[]'::jsonb,
    'snapshot',jsonb_build_object('payments',snapshot->'payments','invoices',snapshot->'invoices','memories',snapshot->'memories'),
    'reason','Two instalments','allocations',jsonb_build_array(jsonb_build_object('payment_id',p1,'invoice_id',inv,'amount',40),jsonb_build_object('payment_id',p2,'invoice_id',inv,'amount',60)));
  claim:=public.claim_payment_assistance_job(org);
  if public.claim_payment_assistance_job(org) is not null then raise exception 'Concurrent lease claimed'; end if;
  perform public.finish_payment_assistance_job(org,(claim->>'lease_token')::uuid,(snapshot->>'generation')::bigint,jsonb_build_array(proposal),null,1);
  select id into prop from public.payment_assistance_proposals where organization_id=org;
  begin perform public.decide_payment_assistance(org,actor,prop,true); raise exception 'Shadow booked';
    exception when others then if sqlerrm<>'assistance_disabled' then raise; end if; end;
  if (select paid_amount from public.invoices where id=inv)<>0 then raise exception 'Shadow changed money'; end if;
  perform public.configure_payment_assistance(org,'review',true,true);
  snapshot:=public.payment_assistance_inputs(org);
  proposal:=jsonb_set(proposal,'{snapshot}',jsonb_build_object('payments',snapshot->'payments','invoices',snapshot->'invoices','memories',snapshot->'memories'));
  claim:=public.claim_payment_assistance_job(org);
  perform public.finish_payment_assistance_job(org,(claim->>'lease_token')::uuid,(snapshot->>'generation')::bigint,jsonb_build_array(proposal),null,1);
  select id into prop from public.payment_assistance_proposals where organization_id=org and status='pending';
  begin perform public.decide_payment_assistance(org,other_actor,prop,true); raise exception 'Cross-org booked';
    exception when others then if sqlerrm<>'insufficient_permission' then raise; end if; end;
  response:=public.decide_payment_assistance(org,actor,prop,true);
  if (select paid_amount from public.invoices where id=inv)<>100 then raise exception 'Incorrect balance'; end if;
  if (select count(*) from public.bank_payment_allocations where organization_id=org and is_committed)<>2 then raise exception 'Ledger allocations missing'; end if;
  response:=public.decide_payment_assistance(org,actor,prop,true);
  if not (response->>'idempotent')::boolean then raise exception 'Retry is not idempotent'; end if;
  mem:=public.save_payment_payer_memory(org,actor,null,0,'12345678','123/0100',null,null,array[p1,p2],true);
  perform public.unassign_bank_payment_allocations(org,p1,actor);
  if (select active from public.payment_payer_memory where id=mem) then raise exception 'Source reversal left memory active'; end if;
  if (select paid_amount from public.invoices where id=inv)<>60 then raise exception 'Release broke remaining ledger'; end if;
  if not exists(select 1 from public.payment_assistance_events where entity_id=mem) then raise exception 'Memory audit missing'; end if;
  begin perform public.save_payment_payer_memory(org,actor,null,0,'12345678','123/0100',null,null,array[p1],true); raise exception 'Unallocated memory source accepted';
    exception when others then if sqlerrm<>'unconfirmed_memory_source' then raise; end if; end;
  -- Expired leases are recoverable without deleting the durable request.
  update public.payment_assistance_jobs set lease_token=gen_random_uuid(),lease_until=now()-interval '1 minute' where organization_id=org;
  if public.claim_payment_assistance_job(org) is null then raise exception 'Lease restart failed'; end if;
  if has_function_privilege('authenticated','public.decide_payment_assistance(uuid,uuid,uuid,boolean)','EXECUTE') then raise exception 'Public money RPC'; end if;
  if has_table_privilege('authenticated','public.payment_payer_memory','SELECT') then raise exception 'Public memory table'; end if;
end $$;
rollback;
