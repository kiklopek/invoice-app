begin;
do $$
declare org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); inv uuid:=gen_random_uuid(); first_claim jsonb; retry jsonb; result jsonb; denied boolean:=false;
begin
  insert into auth.users(id,email) values(actor,actor||'@example.invalid'),(viewer,viewer||'@example.invalid');
  insert into public.organizations(id,name,ico) values(org,'Email test supplier','12345678'),(other_org,'Other supplier','87654321');
  insert into public.subscriptions(organization_id,status,plan,period,billing_exempt) values(org,'active','business','yearly',true);
  insert into public.organization_members(organization_id,user_id,email,role) values(org,actor,actor||'@example.invalid','admin'),(org,viewer,viewer||'@example.invalid','viewer');
  insert into public.invoices(id,organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by)
    values(inv,org,'EMAIL-1','Recipient','recipient@example.invalid',100,21,121,'CZK',current_date,current_date+14,actor);
  begin perform public.claim_invoice_email(org,viewer,inv,'manual',null,repeat('a',64)); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'viewer could send'; end if;
  denied:=false;
  begin perform public.claim_invoice_email(other_org,actor,inv,'manual',null,repeat('a',64)); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'foreign tenant could send'; end if;
  insert into public.email_suppressions(organization_id,email,reason,last_event_at) values(other_org,'recipient@example.invalid','complained',now());
  first_claim:=public.claim_invoice_email(org,actor,inv,'manual',null,repeat('a',64));
  if first_claim->>'state'<>'claimed' then raise exception 'foreign suppression leaked: %', first_claim; end if;
  result:=public.stage_invoice_email(org,(first_claim->>'id')::uuid,(first_claim->>'lease_token')::uuid,'{"to":"recipient@example.invalid","html":"Original","attachments":[{"content":"cGRm"}]}'::jsonb);
  if result->>'html'<>'Original' then raise exception 'payload not frozen'; end if;
  result:=public.claim_invoice_email(org,actor,inv,'manual',null,repeat('a',64));
  if result->>'state'<>'busy' then raise exception 'concurrent send accepted'; end if;
  if public.finish_invoice_email(org,(first_claim->>'id')::uuid,gen_random_uuid(),'wrong') then raise exception 'wrong lease accepted'; end if;
  perform public.finish_invoice_email(org,(first_claim->>'id')::uuid,(first_claim->>'lease_token')::uuid,null);
  retry:=public.claim_invoice_email(org,actor,inv,'manual','new-client-key',repeat('a',64));
  if retry->>'state'<>'claimed' or retry->>'id'<>first_claim->>'id' then raise exception 'retry lost provider identity'; end if;
  if retry->>'lease_token'=first_claim->>'lease_token' then raise exception 'retry reused lease'; end if;
  result:=public.stage_invoice_email(org,(retry->>'id')::uuid,(retry->>'lease_token')::uuid,'{"html":"Regenerated PDF"}'::jsonb);
  if result->>'html'<>'Original' then raise exception 'retry changed provider payload'; end if;
  perform public.finish_invoice_email(org,(retry->>'id')::uuid,(retry->>'lease_token')::uuid,'provider-1');
  result:=public.claim_invoice_email(org,actor,inv,'manual','new-client-key',repeat('a',64));
  if result->>'state'<>'accepted' then raise exception 'adopted action key not deduplicated'; end if;
  result:=public.claim_invoice_email(org,actor,inv,'manual',null,repeat('a',64));
  if result->>'state'<>'accepted' then raise exception 'accepted send not deduplicated'; end if;
  result:=public.claim_invoice_email(org,actor,inv,'manual','intentional-resend',repeat('a',64));
  if result->>'state'<>'claimed' or result->>'id'=retry->>'id' then raise exception 'intentional resend unavailable'; end if;
  perform public.finish_invoice_email(org,(result->>'id')::uuid,(result->>'lease_token')::uuid,null);
  result:=public.claim_invoice_email(org,actor,inv,'manual','changed',repeat('b',64));
  if result->>'state'<>'conflict' then raise exception 'changed payload reused previous action'; end if;
  update public.invoice_email_deliveries set created_at=clock_timestamp()-interval '25 hours' where action_key='intentional-resend' and organization_id=org;
  result:=public.claim_invoice_email(org,actor,inv,'manual','intentional-resend',repeat('a',64));
  if result->>'state'<>'expired' then raise exception 'expired provider key allowed'; end if;
  insert into public.email_suppressions(organization_id,email,reason,last_event_at) values(org,'recipient@example.invalid','complained',now());
  result:=public.claim_invoice_email(org,actor,inv,'issue',null,repeat('a',64));
  if result->>'state'<>'suppressed' then raise exception 'suppressed issue allowed'; end if;
  result:=public.claim_invoice_email(org,actor,inv,'manual',null,repeat('a',64));
  if result->>'state'<>'suppressed' then raise exception 'suppressed manual send allowed'; end if;
  if has_table_privilege('authenticated','public.invoice_email_deliveries','select')
    or has_function_privilege('authenticated','public.claim_invoice_email(uuid,uuid,uuid,text,text,text)','execute')
    or has_function_privilege('anon','public.finish_invoice_email(uuid,uuid,uuid,text)','execute') then raise exception 'mail actions exposed to browser'; end if;
end $$;
rollback;
