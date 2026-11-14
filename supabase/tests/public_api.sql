begin;
do $$
declare
  org_a uuid := gen_random_uuid(); org_b uuid := gen_random_uuid();
  admin_a uuid := gen_random_uuid(); admin_b uuid := gen_random_uuid();
  issued_key_id uuid; key_b uuid; result jsonb; result_b jsonb; failed boolean;
  first_number text; second_number text;
begin
  insert into auth.users(id,email) values (admin_a,'api-a@example.com'), (admin_b,'api-b@example.com');
  insert into public.organizations(id,name,ico) values (org_a,'API A','27082440'), (org_b,'API B','25596641');
  insert into public.organization_members(organization_id,user_id,email,role) values
    (org_a,admin_a,'api-a@example.com','admin'),(org_b,admin_b,'api-b@example.com','admin');
  execute 'set local role service_role';

  result := public.create_organization_api_key(org_a,admin_a,'E-shop','abcdefgh',repeat('a',64),array['invoices:read','invoices:write'],null);
  issued_key_id := (result->>'id')::uuid;
  if result ? 'key_hash' then raise exception 'management response exposes hash'; end if;
  result_b := public.create_organization_api_key(org_b,admin_b,'Other','ijklmnop',repeat('b',64),array['invoices:read'],null);
  key_b := (result_b->>'id')::uuid;

  if public.authenticate_organization_api_key(repeat('c',64),'invoices:read')->>'status' <> 'invalid' then raise exception 'unknown key accepted'; end if;
  if public.authenticate_organization_api_key(repeat('a',64),'invoices:send')->>'status' <> 'forbidden' then raise exception 'scope bypass'; end if;
  result := public.authenticate_organization_api_key(repeat('a',64),'invoices:write');
  if result->>'status' <> 'ok' or (result->>'organization_id')::uuid <> org_a or (result->>'acting_user_id')::uuid <> admin_a then raise exception 'wrong key identity'; end if;

  update public.organization_api_keys set request_limit=1,rate_window_count=0,rate_window_started_at=clock_timestamp() where id=issued_key_id;
  if public.authenticate_organization_api_key(repeat('a',64),'invoices:read')->>'status' <> 'ok' then raise exception 'first limited request failed'; end if;
  if public.authenticate_organization_api_key(repeat('a',64),'invoices:read')->>'status' <> 'rate_limited' then raise exception 'rate limit bypass'; end if;
  update public.organization_api_keys set rate_window_started_at=clock_timestamp()-interval '2 minutes' where id=issued_key_id;
  if public.authenticate_organization_api_key(repeat('a',64),'invoices:read')->>'status' <> 'ok' then raise exception 'rate window failed to reset'; end if;

  update public.organization_members set role='accounting' where organization_id=org_a and user_id=admin_a;
  if public.authenticate_organization_api_key(repeat('a',64),'invoices:read')->>'status' <> 'invalid' then raise exception 'demoted key owner remains authorized'; end if;
  update public.organization_members set role='admin' where organization_id=org_a and user_id=admin_a;
  update public.organization_api_keys set expires_at=clock_timestamp()-interval '1 second' where id=issued_key_id;
  if public.authenticate_organization_api_key(repeat('a',64),'invoices:read')->>'status' <> 'invalid' then raise exception 'expired key accepted'; end if;
  update public.organization_api_keys set expires_at=null where id=issued_key_id;

  failed := false;
  begin perform public.revoke_organization_api_key(org_a,admin_a,key_b); exception when no_data_found then failed:=true; end;
  if not failed then raise exception 'cross-org revocation accepted'; end if;
  perform public.revoke_organization_api_key(org_a,admin_a,issued_key_id);
  perform public.revoke_organization_api_key(org_a,admin_a,issued_key_id);
  if public.authenticate_organization_api_key(repeat('a',64),'invoices:read')->>'status' <> 'invalid' then raise exception 'revoked key accepted'; end if;
  if (select count(*) from public.organization_api_key_events e where e.organization_id=org_a and e.key_id=issued_key_id and e.action='revoked')<>1 then raise exception 'revocation audit missing'; end if;

  insert into public.api_key_requests(organization_id,key_id,request_id,method,path,status,duration_ms)
    values(org_a,issued_key_id,'request-1','POST','/api/v1/invoices',201,15);
  failed:=false;
  begin
    insert into public.api_key_requests(organization_id,key_id,request_id,method,path,status,duration_ms)
      values(org_b,issued_key_id,'request-2','GET','/api/v1/invoices',200,15);
  exception when foreign_key_violation then failed:=true; end;
  if not failed then raise exception 'audit accepted another organization key'; end if;

  first_number := public.reserve_invoice_number(org_a,admin_a,2026);
  second_number := public.reserve_invoice_number(org_a,admin_a,2026);
  if first_number <> 'FV-2026-000001' or second_number <> 'FV-2026-000002' then raise exception 'number reservation duplicates or incorrect format'; end if;
  if public.reserve_invoice_number(org_b,admin_b,2026) <> 'FV-2026-000001' then raise exception 'number series leaks between organizations'; end if;
  failed:=false;
  begin perform public.reserve_invoice_number(org_b,admin_a,2026); exception when insufficient_privilege then failed:=true; end;
  if not failed then raise exception 'cross-org number reservation accepted'; end if;

  if has_table_privilege('anon','public.organization_api_keys','SELECT') or has_table_privilege('authenticated','public.organization_api_keys','SELECT') then raise exception 'client can read API keys'; end if;
  if has_table_privilege('authenticated','public.api_key_requests','INSERT') then raise exception 'client can forge API request audit'; end if;
  if has_table_privilege('service_role','public.api_key_requests','UPDATE') or has_table_privilege('service_role','public.api_key_requests','DELETE')
    or has_table_privilege('service_role','public.organization_api_key_events','UPDATE') or has_table_privilege('service_role','public.organization_api_key_events','DELETE')
    then raise exception 'API audit tables permit modification of recorded events'; end if;
  if has_function_privilege('anon','public.authenticate_organization_api_key(text,text)','EXECUTE') or has_function_privilege('authenticated','public.reserve_invoice_number(uuid,uuid,integer)','EXECUTE') then raise exception 'client can invoke privileged API RPC'; end if;
end $$;
rollback;
