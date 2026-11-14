begin;
do $$
declare
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  actor uuid := gen_random_uuid(); other_actor uuid := gen_random_uuid(); accountant uuid := gen_random_uuid();
  request_id uuid := gen_random_uuid(); customer_id uuid; result jsonb;
  payload jsonb := '{"name":"API customer","address":"Test address","ico":"12345670","dic":"","email":"customer@example.com"}';
  request_hash text := repeat('a',64);
begin
  insert into auth.users(id,email) values(actor,actor::text||'@example.com'),(other_actor,other_actor::text||'@example.com'),(accountant,accountant::text||'@example.com');
  insert into public.organizations(id,name,ico) values(org,'API fixture','12345678'),(other_org,'Other API fixture','87654321');
  insert into public.organization_members(organization_id,user_id,email,role) values
    (org,actor,actor::text||'@example.com','admin'),(other_org,other_actor,other_actor::text||'@example.com','admin'),(org,accountant,accountant::text||'@example.com','accounting');
  set local role service_role;
  result := public.create_api_customer(org,actor,request_id,request_hash,payload);
  if result->>'replayed' <> 'false' then raise exception 'First request should create'; end if;
  customer_id := (result->'customer'->>'id')::uuid;
  if (select count(*) from public.api_customer_requests where organization_id=org)<>1 then raise exception 'Missing request record'; end if;
  if result->'customer' ? 'organization_id' or result->'customer' ? 'created_by' then raise exception 'Private fields exposed'; end if;

  update public.customers set email='changed@example.com' where id=customer_id;
  result := public.create_api_customer(org,actor,request_id,request_hash,payload);
  if result->>'replayed' <> 'true' or result->'customer'->>'email' <> 'changed@example.com' then raise exception 'Replay failed after contact edit'; end if;
  if (select count(*) from public.customers where organization_id=org)<>1 then raise exception 'Duplicate customer'; end if;

  begin
    perform public.create_api_customer(org,actor,request_id,repeat('b',64),payload||'{"name":"Changed"}');
    raise exception 'Changed content accepted';
  exception when raise_exception then
    if sqlerrm <> 'API_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;
  begin
    perform public.create_api_customer(org,actor,gen_random_uuid(),request_hash,payload);
    raise exception 'Duplicate ICO accepted';
  exception when unique_violation then null; end;
  if (select count(*) from public.api_customer_requests where organization_id=org)<>1 then raise exception 'Partial failed request retained'; end if;

  begin
    perform public.create_api_customer(org,other_actor,gen_random_uuid(),request_hash,payload);
    raise exception 'Other organization actor accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_api_customer(org,accountant,gen_random_uuid(),request_hash,payload);
    raise exception 'Accounting actor accepted';
  exception when insufficient_privilege then null; end;
  update public.organization_members set support_expires_at=now()+interval '1 hour',support_reason='API test temporary admin' where organization_id=org and user_id=actor;
  begin
    perform public.create_api_customer(org,actor,request_id,request_hash,payload);
    raise exception 'Temporary admin accepted';
  exception when insufficient_privilege then null; end;
  update public.organization_members set support_expires_at=null,support_reason=null where organization_id=org and user_id=actor;

  -- Request namespace remains isolated even for equal external request identifiers.
  result := public.create_api_customer(other_org,other_actor,request_id,request_hash,payload);
  if result->'customer'->>'id'=customer_id::text then raise exception 'Other org replayed foreign resource'; end if;
  if private.customer_is_disposable(customer_id) then raise exception 'Explicit API customer considered import residue'; end if;
  insert into public.customers(organization_id,name) values(org,'Unused import residue');
  if not private.customer_is_disposable((select id from public.customers where organization_id=org and name='Unused import residue')) then raise exception 'Ordinary cleanup disabled'; end if;

  if has_table_privilege('anon','public.api_customer_requests','SELECT') or has_table_privilege('authenticated','public.api_customer_requests','SELECT') then raise exception 'Client access to idempotency ledger'; end if;
  if has_table_privilege('service_role','public.api_customer_requests','UPDATE') or has_table_privilege('service_role','public.api_customer_requests','DELETE') then raise exception 'API service may mutate original request history'; end if;
  if has_function_privilege('anon','public.create_api_customer(uuid,uuid,uuid,text,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.create_api_customer(uuid,uuid,uuid,text,jsonb)','EXECUTE') then raise exception 'Client access to creation RPC'; end if;
end $$;
rollback;
