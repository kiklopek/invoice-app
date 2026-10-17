begin;
do $$
declare
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  actor uuid := gen_random_uuid(); other_actor uuid := gen_random_uuid();
  result jsonb; term text; found_count integer;
  fields text[] := array['Novák & synové', 'FV-2026/001', 'info@novak.cz', '+420 777 123 456', 'CZ12345678', 'Dlouhá 12, Brno', null];
begin
  foreach term in array array['novak', 'SYNOVE novak', '  Brno   NOVÁK  ', 'novak 2026', 'FV2026001', '777123456', '777 123', 'CZ1234', 'info@novak.cz', 'Dlouha', '', 'Nova' || chr(769) || 'k'] loop
    if not public.search_text_matches(fields, term) then raise exception 'Expected match: %', term; end if;
    if public.search_prefilter(term) is not null and public.search_document(fields) not like public.search_prefilter(term) then raise exception 'Prefilter lost match: %', term; end if;
  end loop;
  foreach term in array array['novak ostrava', 'FV2026002', '%', '_', 'a,or(id.eq.1)', 'cizifirma'] loop
    if public.search_text_matches(fields, term) then raise exception 'Unexpected match: %', term; end if;
  end loop;
  if public.search_text_matches(array['123','456'], '123456') then raise exception 'Identifier crossed fields'; end if;
  if not public.search_text_matches(array['a_b'], 'a_b') or public.search_text_matches(array['axb'], 'a_b') then raise exception 'Underscore treated as wildcard'; end if;

  insert into auth.users(id,email) values (actor, actor::text || '@search.cz'), (other_actor, other_actor::text || '@search.cz');
  insert into public.organizations(id,name,ico) values (org,'Search fixture','12345678'), (other_org,'Other fixture','87654321');
  insert into public.subscriptions(organization_id,status,plan,period,billing_exempt) values
    (org,'active','business','yearly',true), (other_org,'active','business','yearly',true);
  insert into public.organization_members(organization_id,user_id,email,role) values
    (org,actor,actor::text || '@search.cz','accounting'), (other_org,other_actor,other_actor::text || '@search.cz','admin');
  insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_ico,counterparty_dic,counterparty_email,
    amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by,notes) values
    (org,'FV-2026/001','Novák & synové','12345670','CZ12345670','info@novak.cz',100,0,100,'CZK',current_date,current_date,actor,'Montáž kuchyně'),
    (org,'FV-2026/002','Novák & synové','12345670','CZ12345670','info@novak.cz',200,0,200,'CZK',current_date,current_date,actor,'Oprava'),
    (org,'FV-2025/003','Jiná firma','12345671','CZ12345671','info@jina.cz',300,0,300,'CZK',current_date,current_date,actor,'Oprava'),
    (other_org,'FV-2026/001','Novák & synové','12345670','CZ12345670','info@novak.cz',999,0,999,'CZK',current_date,current_date,other_actor,'Montáž kuchyně');

  result := public.list_invoices_page_filtered(org,actor,'novak 2026',page_size => 1);
  if (result->>'total')::integer <> 2 or jsonb_array_length(result->'invoices') <> 1 or (result->'open_totals'->>'CZK')::numeric <> 300 then raise exception 'Pagination/totals/tenant boundary failed'; end if;
  if (public.list_invoices_page_filtered(org,actor,'FV2026001')->>'total')::integer <> 1 then raise exception 'Compact invoice search failed'; end if;
  if (public.list_invoices_page_filtered(org,actor,'kuchyne novak')->>'total')::integer <> 1 then raise exception 'Notes search failed'; end if;
  if (public.list_invoices_page_filtered(org,actor,'CZ12345671')->>'total')::integer <> 1 then raise exception 'Tax ID search failed'; end if;
  if (public.list_invoices_page_filtered(org,actor,'%')->>'total')::integer <> 0 then raise exception 'Wildcard broadened search'; end if;
  if (public.list_invoices_page_filtered(org,actor,null)->>'total')::integer <> 3 then raise exception 'Empty query failed'; end if;

  update public.customers set phone='+420 777 123 456', address='Dlouhá 12, Brno' where organization_id=org and ico='12345670';
  select count(*) into found_count from public.search_customers(org,actor,'novak Brno');
  if found_count <> 1 then raise exception 'Combined customer search failed'; end if;
  select count(*) into found_count from public.search_customers(org,actor,'777123456');
  if found_count <> 1 then raise exception 'Compact phone search failed'; end if;
  select count(*) into found_count from public.search_customers(org,actor,'novak');
  if found_count <> 1 then raise exception 'Customer tenant boundary failed'; end if;
  begin
    perform public.search_customers(other_org,actor,'novak');
    raise exception 'Foreign membership accepted';
  exception when raise_exception then
    if sqlerrm <> 'insufficient_permission' then raise; end if;
  end;
  begin
    perform public.list_invoices_page_filtered(other_org,actor,'novak');
    raise exception 'Foreign invoice membership accepted';
  exception when raise_exception then
    if sqlerrm <> 'insufficient_permission' then raise; end if;
  end;
  if has_function_privilege('anon','public.search_customers(uuid,uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.search_customers(uuid,uuid,text)','EXECUTE') then raise exception 'RPC exposed to public clients'; end if;
  if not exists(select 1 from pg_indexes where indexname='invoices_normalized_search_trgm')
    or not exists(select 1 from pg_indexes where indexname='customers_normalized_search_trgm') then raise exception 'Search indexes missing'; end if;
end $$;
rollback;
