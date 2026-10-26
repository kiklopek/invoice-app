begin;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
do $$
declare org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); inv uuid:=gen_random_uuid(); payment uuid:=gen_random_uuid(); statement uuid:=gen_random_uuid(); grouped_payment uuid:=gen_random_uuid(); eid uuid; feed jsonb; cutoff timestamptz; cnt integer; failure text;
begin
  insert into auth.users(id,email) values(a,a||'@example.cz'),(b,b||'@example.cz'),(outsider,outsider||'@example.cz'),(viewer,viewer||'@example.cz');
  insert into public.organizations(id,name,ico) values(org,'Notification A','12345678'),(other_org,'Notification B','87654321');
  insert into public.subscriptions(organization_id,status,plan,period,billing_exempt) values(org,'active','business','yearly',true),(other_org,'active','business','yearly',true);
  insert into public.organization_members(organization_id,user_id,email,role) values(org,a,a||'@example.cz','admin'),(org,b,b||'@example.cz','accounting'),(org,viewer,viewer||'@example.cz','viewer'),(other_org,outsider,outsider||'@example.cz','admin');
  insert into public.invoices(id,organization_id,invoice_number,counterparty_name,counterparty_ico,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by)
    values(inv,org,'N-1','Customer','55555555','contact@example.cz',100,0,100,'CZK',current_date-10,current_date-1,a);
  update public.invoices set status='overdue' where id=inv;
  update public.invoices set notes='Unrelated edit' where id=inv;
  insert into public.invoice_events(organization_id,invoice_id,event_type) values(org,inv,'overdue');
  if (select count(*) from public.notification_events where organization_id=org and type='invoice_overdue')<>1 then raise exception 'Duplicate or missing overdue event'; end if;
  if exists(select 1 from public.notification_events where organization_id=org and type in('customer_created','reminders_paused')) then raise exception 'Routine activity created notification'; end if;
  select id into eid from public.notification_events where organization_id=org and type='invoice_overdue';
  perform public.read_notifications(org,a,array[eid]);
  perform public.read_notifications(org,a,array[eid]);
  if (select count(*) from public.notification_reads where event_id=eid)<>1 then raise exception 'Read is not idempotent'; end if;
  if not exists(select 1 from jsonb_array_elements(public.notification_feed(org,b)->'items') n where n->>'id'=eid::text and n->>'read_at' is null) then raise exception 'User B must remain unread'; end if;
  if not exists(select 1 from jsonb_array_elements(public.notification_feed(org,a)->'items') n where n->>'id'=eid::text and n->>'read_at' is not null) then raise exception 'User A read not persisted'; end if;
  begin perform public.notification_feed(other_org,a); raise exception 'foreign membership accepted'; exception when insufficient_privilege then null; end;
  begin perform public.read_notifications(other_org,outsider,array[eid]); raise exception 'foreign event accepted'; exception when insufficient_privilege then null; end;
  perform public.confirm_manual_payment(org,inv,a,100,current_date);
  if not exists(select 1 from public.notification_events where entity_id=inv and type='invoice_paid') then raise exception 'Missing settled invoice event'; end if;
  update public.invoices set paid_at=paid_at+interval '1 second' where id=inv;
  if (select count(*) from public.notification_events where entity_id=inv and type='invoice_paid')<>1 then raise exception 'Date correction emitted duplicate payment'; end if;
  insert into public.reminder_log(organization_id,invoice_id,stage,scheduled_for,sent_to,status,attempt_count)
    values(org,inv,'overdue',current_date,'contact@example.cz','failed',1);
  if not exists(select 1 from public.notification_events where entity_id=inv and type='reminder_failed') then raise exception 'Missing reminder failure'; end if;
  update public.reminder_log set status='sent',sent_at=now(),provider_message_id='test-message' where organization_id=org;
  if exists(select 1 from public.notification_events where entity_id=inv and type='reminder_sent') then raise exception 'Successful reminder created noise'; end if;
  update public.reminder_log set delivery_status='bounced' where organization_id=org;
  if (select count(*) from public.notification_events where entity_id=inv and type='reminder_failed')<>2 then raise exception 'Delivery failure not observed'; end if;
  insert into public.invoice_uploads(organization_id,path,original_name,expected_mime,expected_size,expires_at,ocr_status,ocr_attempt_count)
    values(org,org||'/notification-fixture.pdf','Notification fixture.pdf','application/pdf',100,now()+interval '1 day','failed',1);
  if not exists(select 1 from public.notification_events where organization_id=org and type='import_failed') then raise exception 'Missing OCR failure'; end if;
  update public.subscriptions set status='past_due',stripe_synced_at=clock_timestamp() where organization_id=org;
  if not exists(select 1 from public.notification_events where organization_id=org and type='subscription_problem') then raise exception 'Missing billing event'; end if;
  update public.subscriptions set status='active' where organization_id=org;
  -- Only a stored payment requiring attention creates an individual notification.
  insert into public.bank_payments(id,organization_id,external_id,booked_on,amount,currency,match_status) values(payment,org,'NOTIF-PAY',current_date,100,'CZK','unmatched');
  set constraints notification_payment, notification_statement immediate;
  if exists(select 1 from public.notification_events where organization_id=org and type in('payment_received','payment_matched','customer_created','reminder_sent','reminders_paused')) then raise exception 'Unapproved routine activity created notification'; end if;
  if not exists(select 1 from public.notification_events where entity_id=payment and type='payment_unmatched') then raise exception 'Stored payment missing'; end if;
  if exists(select 1 from jsonb_array_elements(public.notification_feed(org,viewer)->'items') n where n->>'type'='payment_unmatched') then raise exception 'Viewer received restricted operations'; end if;
  select id into eid from public.notification_events where entity_id=payment;
  begin perform public.read_notifications(org,viewer,array[eid]); raise exception 'Viewer marked restricted event'; exception when insufficient_privilege then null; end;
  -- Batch notices use the final import state, not one event per payment.
  set constraints notification_payment, notification_statement deferred;
  insert into public.bank_statement_imports(id,organization_id,source_format,original_filename,file_hash,created_by)
    values(statement,org,'gpc','notification-batch.gpc',repeat('a',64),a);
  insert into public.bank_payments(id,organization_id,external_id,booked_on,amount,currency,match_status) values(grouped_payment,org,'GROUPED-PAY',current_date,100,'CZK','unmatched');
  insert into public.bank_statement_entries(organization_id,import_id,line_number,record_type,fingerprint,disposition,amount,currency,proposal_confidence,bank_payment_id)
    select org,statement,n,'075',md5(n::text)||md5(n::text),'accepted',100,'CZK',case when n>3 then 'safe' else 'review' end,
      case when n=1 then grouped_payment else null end from generate_series(1,5) n;
  update public.bank_statement_imports set entry_count=5,accepted_count=5 where id=statement;
  set constraints notification_payment, notification_statement immediate;
  if exists(select 1 from public.notification_events where entity_id=grouped_payment) then raise exception 'Batch payment emitted duplicate individual event'; end if;
  if (select count(*) from public.notification_events where entity_id=statement and type='payment_review')<>1 then raise exception 'Batch not grouped'; end if;
  if not exists(select 1 from public.notification_events where entity_id=statement and message like 'Počet plateb ke kontrole: 3.%') then raise exception 'Batch count includes safe rows'; end if;
  perform public.read_notifications(org,a,array(select id from public.notification_events where entity_id=statement));
  update public.bank_statement_imports set updated_at=clock_timestamp() where id=statement;
  if (select count(*) from public.notification_events where entity_id=statement)<>1 then raise exception 'Repeated import update duplicated summary'; end if;
  if exists(select 1 from jsonb_array_elements(public.notification_feed(org,viewer,false,50)->'items') n where n->>'type' in('subscription_problem','member_changed','payment_review','reminder_failed','import_failed')) then raise exception 'Viewer received restricted event'; end if;
  if exists(select 1 from jsonb_array_elements(public.notification_feed(org,b,false,50)->'items') n where n->>'type' in('subscription_problem','member_changed')) then raise exception 'Accountant received admin event'; end if;
  -- A failed import remains actionable without inventing a transaction.
  update public.bank_statement_imports set status='failed' where id=statement;
  if not exists(select 1 from public.notification_events where entity_id=statement and type='import_failed') then raise exception 'Missing statement failure'; end if;
  feed:=public.notification_feed(org,b,false,2); cutoff:=(feed->>'through')::timestamptz;
  perform private.emit_notification(org,'late-event','invoice_paid','Later event','Arrived after snapshot','invoice',inv,array['accounting','admin']);
  perform public.read_notifications(org,b,null,cutoff);
  if (public.notification_feed(org,b)->>'unread_count')::integer<>1 then raise exception 'Mark all swallowed concurrent arrival'; end if;
  if (public.notification_feed(org,b,true)->>'total')::integer<>1 then raise exception 'Unread filter wrong'; end if;
  if not (feed->>'has_more')::boolean then raise exception 'Missing keyset pagination'; end if;
  -- Deleted entities have no broken navigation target, but retain their historical event.
  delete from public.bank_payments where id=payment;
  if exists(select 1 from jsonb_array_elements(public.notification_feed(org,a,false,50)->'items') n where n->>'id'=eid::text and n->>'href' is not null) then raise exception 'Deleted payment still actionable'; end if;
  if has_function_privilege('authenticated','private.emit_notification(uuid,text,text,text,text,text,uuid,text[])','execute') then raise exception 'Client can forge events'; end if;
  if has_table_privilege('anon','public.notification_events','select') then raise exception 'Anonymous event access'; end if;
  if exists(select 1 from pg_class where oid in('public.notification_events'::regclass,'public.notification_reads'::regclass) and not relrowsecurity) then raise exception 'RLS missing'; end if;
  -- A user with legitimate memberships in two companies keeps separate receipts.
  insert into public.organization_members(organization_id,user_id,email,role) values(other_org,a,a||'@example.cz','admin');
  perform private.emit_notification(other_org,'other-event','invoice_paid','Other company event','','organization',other_org,array['admin']);
  if (public.notification_feed(other_org,a)->>'unread_count')::integer<>1 then raise exception 'Second company state leaked'; end if;
  perform public.read_notifications(org,a,null,clock_timestamp());
  if (public.notification_feed(other_org,a)->>'unread_count')::integer<>1 then raise exception 'Reading first company consumed second company event'; end if;
  delete from public.organization_members where organization_id=other_org and user_id=a;
  -- Exercise actual service-role ACLs, not only the database owner's privileges.
  execute 'set local role service_role';
  perform public.notification_feed(org,a);
  perform public.read_notifications(org,a,array[eid]);
  execute 'reset role';
  -- RLS: no reads for another user, no event write privilege, no service-only RPC access.
  perform set_config('test.uid',a::text,true);
  execute 'set local role authenticated';
  select count(*) into cnt from public.notification_reads where user_id=b;
  if cnt<>0 then raise exception 'RLS exposed another user reads'; end if;
  select count(*) into cnt from public.notification_events where organization_id=other_org;
  if cnt<>0 then raise exception 'RLS exposed foreign company'; end if;
  begin insert into public.notification_events(organization_id,event_key,type,title,message,entity_type,entity_id,roles) values(org,'forged','invoice_paid','forged','','invoice',inv,array['admin']); raise exception 'Client wrote event'; exception when insufficient_privilege then null; end;
  begin perform public.notification_feed(org,a); raise exception 'Client called service RPC'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  -- Historical volume stays paginated and keyset pages never overlap.
  insert into public.notification_events(organization_id,event_key,type,title,message,entity_type,entity_id,roles)
    select org,'history:'||n,'invoice_paid','Historical event','','invoice',inv,array['admin'] from generate_series(1,10000) n;
  feed:=public.notification_feed(org,a,false,50);
  if jsonb_array_length(feed->'items')<>50 or not (feed->>'has_more')::boolean then raise exception 'Unbounded history payload'; end if;
  if exists(select 1 from jsonb_array_elements(feed->'items') first_page join jsonb_array_elements(public.notification_feed(org,a,false,50,(feed->'items'->49->>'created_at')::timestamptz,(feed->'items'->49->>'id')::uuid)->'items') next_page on first_page->>'id'=next_page->>'id') then raise exception 'Keyset pages overlap'; end if;
  -- Removing membership immediately revokes access, including unread state.
  delete from public.organization_members where organization_id=org and user_id=b;
  begin perform public.notification_feed(org,b); raise exception 'Removed member still has access'; exception when insufficient_privilege then null; end;
  -- A notification failure cannot roll back an existing business operation.
  execute $change$create or replace function private.emit_notification(org uuid,key text,kind text,heading text,body text,entity text,entity_uuid uuid,audience text[]) returns void language plpgsql security definer set search_path='' as $fn$begin raise exception 'injected notification failure'; end;$fn$ $change$;
  update public.invoices set reminders_paused=true where id=inv;
  if not (select reminders_paused from public.invoices where id=inv) then raise exception 'Notification broke invoice update'; end if;
end $$;
rollback;
