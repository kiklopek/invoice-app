begin;
do $$
declare org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); statement uuid:=gen_random_uuid();
  snapshot jsonb; report jsonb; chart jsonb; r record; cur text; st text; expected numeric;
begin
  insert into auth.users(id,email) values(actor,actor||'@example.invalid'),(outsider,outsider||'@example.invalid');
  insert into public.organizations(id,name,ico) values(org,'Dashboard fixture','12345678'),(other_org,'Other fixture','87654321');
  insert into public.subscriptions(organization_id,status,plan,period,billing_exempt) values(org,'active','business','yearly',true),(other_org,'active','business','yearly',true);
  insert into public.organization_members(organization_id,user_id,email,role) values(org,actor,actor||'@example.invalid','admin'),(other_org,outsider,outsider||'@example.invalid','admin');
  insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,paid_amount,currency,issue_date,due_date,status,created_by,next_reminder_at,reminders_sent,paid_at)
    select org,'D-'||n,'Customer','contact@example.invalid',100,0,100,
      case when n%4=0 then 100 when n%4=3 then 0 else 25 end,case when n%3=0 then 'CZK' else 'EUR' end,
      date '2026-10-19'-(n%400),date '2026-10-20',
      (array['paid','pending','overdue','cancelled'])[n%4+1],actor,
      case when n%4 in (1,2) then timestamp with time zone '2026-10-20 08:00:00+02' end,2,case when n%4=0 then timestamp with time zone '2026-10-19 08:00:00+02' end
    from generate_series(1,1001) n;
  insert into public.invoices(organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by)
    values(other_org,'OTHER','Other','other@example.invalid',999999,0,999999,'USD','2026-10-19','2026-10-20',outsider);

  insert into public.invoice_uploads(organization_id,path,original_name,expected_mime,expected_size,expires_at,ocr_status)
    values(org,org||'/ready.pdf','ready.pdf','application/pdf',100,now()+interval '1 day','succeeded'),
      (org,org||'/expired.pdf','expired.pdf','application/pdf',100,now()-interval '1 day','succeeded'),
      (other_org,other_org||'/other.pdf','other.pdf','application/pdf',100,now()+interval '1 day','succeeded');
  insert into public.bank_statement_imports(id,organization_id,source_format,original_filename,file_hash,created_by)
    values(statement,org,'gpc','dashboard.gpc',repeat('a',64),actor);
  insert into public.bank_statement_entries(organization_id,import_id,line_number,record_type,fingerprint,disposition,amount,currency,proposal_confidence)
    select org,statement,n,'075',md5(n::text)||md5(n::text),'accepted',100,'CZK',case when n=3 then 'safe' when n=2 then null else 'review' end
    from generate_series(1,3) n;

  for r in select * from (values (null::date,date '2026-10-19'),(date '2026-08-01',date '2026-10-19'),(date '2001-01-01',date '2001-01-01')) p(f,t) loop
    snapshot:=public.dashboard_snapshot(org,actor,r.f,r.t);
    select count(*) into expected from invoices where organization_id=org and issue_date<=r.t and (r.f is null or issue_date>=r.f);
    if (snapshot->>'invoice_count')::numeric<>expected then raise exception 'Cohort count mismatch'; end if;
    select count(*) filter(where status='paid') into expected from invoices where organization_id=org and issue_date<=r.t and (r.f is null or issue_date>=r.f);
    if (snapshot->>'paid_invoice_count')::numeric<>expected then raise exception 'Paid invoice count mismatch'; end if;
    if (snapshot->>'ocr_pending_confirmation')::int<>1 then raise exception 'OCR action count expired or cross tenant'; end if;
    if (snapshot->>'payments_needing_review')::int<>2 then raise exception 'Payment review count mismatch'; end if;
    select count(*) into expected from invoices where organization_id=org and issue_date<=r.t and (r.f is null or issue_date>=r.f);
    if jsonb_array_length(snapshot->'recent')<>least(50,expected) then raise exception 'Preview truncation mismatch'; end if;
    if jsonb_array_length(snapshot->'upcoming')>50 then raise exception 'Upcoming uncapped'; end if;
    if snapshot->'currencies' <> '["CZK","EUR"]'::jsonb then raise exception 'Foreign currency leak'; end if;
    if r.f is not null then
      select count(*) into expected from invoices where organization_id=org and issue_date>=r.f-(r.t-r.f+1) and issue_date<r.f;
      if (snapshot->>'previous_invoice_count')::numeric<>expected then raise exception 'Previous period mismatch'; end if;
    elsif snapshot->'previous_invoice_count'<>'null'::jsonb then raise exception 'All time comparison fabricated'; end if;
    for cur in select distinct currency from invoices where organization_id=org loop
      select coalesce(sum(amount-paid_amount) filter(where status in('pending','overdue')),0) into expected from invoices where organization_id=org and currency=cur and issue_date<=r.t and (r.f is null or issue_date>=r.f);
      if coalesce((snapshot->'open_totals'->>cur)::numeric,0)<>expected then raise exception 'Open balance mismatch'; end if;
      select coalesce(sum(paid_amount) filter(where status<>'cancelled' and paid_amount>0),0) into expected from invoices where organization_id=org and currency=cur and issue_date<=r.t and (r.f is null or issue_date>=r.f);
      if coalesce((snapshot->'paid_totals'->>cur)::numeric,0)<>expected then raise exception 'Partial receipt/storno mismatch'; end if;
      report:=public.invoice_report_summary(org,actor,coalesce(r.f,date '1900-01-01'),r.t,'issue_date',cur,null,null,r.t);
      chart:=snapshot->'charts'->cur;
      if coalesce(chart->'monthly','[]'::jsonb)<>report->'monthly' then raise exception 'Base monthly report mismatch: %',cur; end if;
      foreach st in array array['paid','pending','overdue'] loop
        report:=public.invoice_report_summary(org,actor,coalesce(r.f,date '1900-01-01'),r.t,'issue_date',cur,st,null,r.t);
        if coalesce(chart->'statuses'->st->'monthly','[]'::jsonb)<>report->'monthly' then raise exception 'Status monthly report mismatch: % %',cur,st; end if;
      end loop;
    end loop;
  end loop;
  snapshot:=public.dashboard_snapshot(org,actor,null,'2026-10-19');
  if (snapshot->>'invoice_count')::int<>1001 then raise exception 'Truncated after 1000'; end if;
  if (snapshot->>'reminders_due_soon')::int<=50 then raise exception 'Reminder count capped to preview'; end if;
  begin perform public.dashboard_snapshot(other_org,actor,null,current_date); raise exception 'Cross tenant allowed'; exception when insufficient_privilege then null; end;
  begin perform public.dashboard_snapshot(org,outsider,null,current_date); raise exception 'Outsider allowed'; exception when insufficient_privilege then null; end;
  begin perform public.dashboard_snapshot(org,actor,'2026-10-20','2026-10-19'); raise exception 'Invalid range allowed'; exception when invalid_parameter_value then null; end;
  update public.organization_members set role='viewer' where organization_id=org and user_id=actor;
  perform public.dashboard_snapshot(org,actor,null,current_date);
  update public.organization_members set role='admin', support_reason='Expired test session', support_expires_at=now()-interval '1 second' where organization_id=org and user_id=actor;
  begin perform public.dashboard_snapshot(org,actor,null,current_date); raise exception 'Expired support allowed'; exception when insufficient_privilege then null; end;
  if has_function_privilege('anon','public.dashboard_snapshot(uuid,uuid,date,date)','execute') or has_function_privilege('authenticated','public.dashboard_snapshot(uuid,uuid,date,date)','execute') then raise exception 'Client execute granted'; end if;
  if not has_function_privilege('service_role','public.dashboard_snapshot(uuid,uuid,date,date)','execute') then raise exception 'Server execute missing'; end if;
end;
$$;
rollback;
