begin;
do $$
declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); foreign_org uuid:=gen_random_uuid(); reader uuid:=gen_random_uuid(); snap jsonb; summary jsonb; bank jsonb; imp uuid:=gen_random_uuid(); blocked boolean;
begin
  insert into auth.users(id,email) values(actor,actor||'@example.invalid'),(reader,reader||'@example.invalid');
  insert into public.organizations(id,name,ico) values(org,'Financial report tenant','12345678'),(foreign_org,'Foreign tenant','87654321');
  insert into public.subscriptions(organization_id,status,plan,period,billing_exempt) values(org,'active','business','yearly',true),(foreign_org,'active','business','yearly',true);
  insert into public.organization_members(organization_id,user_id,email,role) values(org,actor,actor||'@example.invalid','admin'),(org,reader,reader||'@example.invalid','viewer');
  insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by)
    select org,'REPORT-'||g,'Company '||(g%7),'client@customer.invalid',case when g=1 then 100000 else 1000 end,21,case when g=1 then 121000 else 1210 end,'CZK','2026-10-01','2026-11-01',actor from generate_series(1,120) g;
  insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by)
    values(foreign_org,'FOREIGN-SECRET','Private company','client@customer.invalid',900,0,900,'CZK','2026-10-01','2026-11-01',actor),
    (org,'OTHER-CURRENCY','Company','client@customer.invalid',900,0,900,'EUR','2026-10-01','2026-11-01',actor);
  insert into public.bank_statement_imports(id,organization_id,source_format,original_filename,file_hash,created_by)
    values(imp,org,'gpc','report.gpc',repeat('b',64),actor);
  insert into public.bank_statement_entries(organization_id,import_id,line_number,record_type,fingerprint,disposition,amount,currency,proposal_confidence)
    select org,imp,n,'075',md5(n::text)||md5(n::text),'accepted',100,'EUR',case when n=1 then 'safe' when n=2 then 'review' else null end from generate_series(1,3) n;
  update public.bank_statement_imports set status='committed',committed_at='2026-09-30 22:30:00+00',accepted_count=3,entry_count=3 where id=imp;
  snap:=public.financial_report_snapshot(org,actor,'2026-10-01','2026-10-31','issue_date','CZK');
  summary:=public.invoice_report_summary(org,actor,'2026-10-01','2026-10-31','issue_date','CZK',null,null,(snap->>'as_of')::date);
  bank:=public.payment_reconciliation_summary(org,actor,'2026-10-01','2026-10-31');
  if jsonb_typeof(snap#>'{exact_totals,total}')<>'string' or (snap#>>'{exact_totals,total}')::numeric<>(summary->>'total')::numeric then raise exception 'exact decimal total lost';end if;
  if snap->'report'<>summary or snap->'payments'<>bank then raise exception 'export differs from authoritative reports'; end if;
  if jsonb_array_length(snap->'imports')<>1 or snap#>>'{imports,0,auto_matched}'<>'1' or snap#>>'{imports,0,needs_review}'<>'2' or snap#>>'{payments,totals,accepted}'<>'3' then raise exception 'bank detail, confidence categories or Prague midnight boundary incorrect';end if;
  if jsonb_array_length(snap->'invoices')<>120 or snap::text like '%FOREIGN-SECRET%' or snap::text like '%OTHER-CURRENCY%' then raise exception 'missing rows or tenant/currency leak'; end if;
  if (select sum((r->>'invoiced')::numeric) from jsonb_array_elements(snap->'customers') r)<>(summary->>'total')::numeric then raise exception 'customer totals mismatch'; end if;
  if snap#>>'{customers,0,name}'<>'Company 1' then raise exception 'customer ranking sorted decimal strings lexically';end if;
  if (select sum((r->>'paid')::numeric) from jsonb_array_elements(snap->'customers') r)<>(summary->>'paid')::numeric then raise exception 'customer payment mismatch'; end if;
  blocked:=false;begin perform public.financial_report_snapshot(foreign_org,actor,'2026-10-01','2026-10-31','issue_date','CZK');exception when others then if sqlerrm='insufficient_permission' then blocked:=true;else raise;end if;end;if not blocked then raise exception 'cross tenant access allowed';end if;
  snap:=public.financial_report_snapshot(org,reader,'2026-10-01','2026-10-31','issue_date','CZK');if snap->'report'<>summary then raise exception 'existing viewer access changed';end if;
  blocked:=false;begin perform public.financial_report_snapshot(org,gen_random_uuid(),'2026-10-01','2026-10-31','issue_date','CZK');exception when others then if sqlerrm='insufficient_permission' then blocked:=true;else raise;end if;end;if not blocked then raise exception 'outsider access allowed';end if;
  if has_function_privilege('authenticated','public.financial_report_snapshot(uuid,uuid,date,date,text,text,text,text)','execute') then raise exception 'RPC callable by end user';end if;
  snap:=public.financial_report_snapshot(org,actor,'2026-10-01','2026-10-31','issue_date','CZK',null,'Company 1');
  if exists(select 1 from jsonb_array_elements(snap->'invoices') r where r->>'counterparty_name'<>'Company 1') then raise exception 'customer filter lost';end if;
  -- No silent truncation beyond the bounded financial export limit.
  insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by)
    select org,'LIMIT-'||g,'Company','client@customer.invalid',1000,21,1210,'CZK','2026-10-01','2026-11-01',actor from generate_series(1,4900) g;
  blocked:=false;begin perform public.financial_report_snapshot(org,actor,'2026-10-01','2026-10-31','issue_date','CZK');exception when others then if sqlerrm='report_too_large' then blocked:=true;else raise;end if;end;if not blocked then raise exception 'export limit silently ignored';end if;
end $$;
rollback;
