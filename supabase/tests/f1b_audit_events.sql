\set ON_ERROR_STOP on
-- Fáze F1b přestavby databáze: jedna neměnná auditní kniha, která přežije
-- smazání faktury, a smazat jde jen fakturu bez peněz a bez odeslaných zpráv.
begin;
do $$
declare
  org uuid := '00000000-0000-4000-8000-0000000001b1';
  admin uuid := '00000000-0000-4000-8000-0000000001b2';
  draft uuid; paid uuid; reminded uuid; emailed uuid;
  failed text; n integer;
begin
  insert into auth.users(id, email) values (admin, 'audit-admin@example.invalid');
  insert into public.organizations(id, name, ico) values (org, 'Audit test s.r.o.', '27074358');
  insert into public.organization_members(organization_id, user_id, email, role) values (org, admin, 'audit-admin@example.invalid', 'admin');
  insert into public.subscriptions(organization_id, status, plan, period, billing_exempt) values (org, 'active', 'business', 'yearly', true);

  -- 1. Kniha je jen pro server a nikdo ji nepřepíše.
  if to_regclass('public.audit_events') is null then raise exception 'audit_events table is missing'; end if;
  if has_table_privilege('anon', 'public.audit_events', 'SELECT') or has_table_privilege('authenticated', 'public.audit_events', 'SELECT')
    or has_table_privilege('authenticated', 'public.audit_events', 'INSERT') then
    raise exception 'client roles can access audit_events';
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.audit_events'::regclass and contype = 'f') then
    raise exception 'audit_events must not cascade from other tables';
  end if;

  -- 2. Události ze stávajících tabulek se do knihy zrcadlí.
  insert into public.invoices(id, organization_id, invoice_number, counterparty_name, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by)
  values
    (gen_random_uuid(), org, 'A-1', 'Odběratel', 'o@example.invalid', 100, 0, 100, 'CZK', current_date, current_date + 14, 'pending', admin),
    (gen_random_uuid(), org, 'A-2', 'Odběratel', 'o@example.invalid', 100, 0, 100, 'CZK', current_date, current_date + 14, 'pending', admin),
    (gen_random_uuid(), org, 'A-3', 'Odběratel', 'o@example.invalid', 100, 0, 100, 'CZK', current_date, current_date + 14, 'pending', admin),
    (gen_random_uuid(), org, 'A-4', 'Odběratel', 'o@example.invalid', 100, 0, 100, 'CZK', current_date, current_date + 14, 'pending', admin);
  select id into draft from public.invoices where organization_id = org and invoice_number = 'A-1';
  select id into paid from public.invoices where organization_id = org and invoice_number = 'A-2';
  select id into reminded from public.invoices where organization_id = org and invoice_number = 'A-3';
  select id into emailed from public.invoices where organization_id = org and invoice_number = 'A-4';
  insert into public.invoice_events(organization_id, invoice_id, actor_user_id, event_type, details)
    values (org, draft, admin, 'reminders_paused', '{"reason":"test"}');
  if not exists (select 1 from public.audit_events where organization_id = org and entity_type = 'invoice'
      and entity_id = draft and action = 'reminders_paused' and actor_user_id = admin and actor_kind = 'user') then
    raise exception 'invoice event not mirrored into audit_events';
  end if;
  select count(*) into n from public.invoice_events e
  where not exists (select 1 from public.audit_events a where a.source_table = 'invoice_events' and a.source_id = e.id::text);
  if n > 0 then raise exception '% invoice events missing from audit_events', n; end if;

  -- 3. Záznam v knize nejde změnit ani smazat, ani serverovou rolí.
  failed := null;
  begin
    update public.audit_events set action = 'tampered' where entity_id = draft;
  exception when others then failed := sqlerrm;
  end;
  if failed is distinct from 'audit_events_immutable' then raise exception 'audit row was updated: %', failed; end if;
  failed := null;
  begin
    delete from public.audit_events where entity_id = draft;
  exception when others then failed := sqlerrm;
  end;
  if failed is distinct from 'audit_events_immutable' then raise exception 'audit row was deleted: %', failed; end if;

  -- 4. Faktura s přiřazenou platbou se nesmaže, jen stornuje.
  insert into public.bank_payments(organization_id, external_id, booked_on, amount, currency, invoice_id, match_status, matched_at)
    values (org, 'AUDIT-PAY', current_date, 100, 'CZK', paid, 'matched', now());
  failed := null;
  begin
    perform public.delete_invoice_safely(org, paid, admin);
  exception when others then failed := sqlerrm;
  end;
  if failed is distinct from 'invoice_has_payments' then raise exception 'invoice with a payment was deleted: %', failed; end if;
  if not exists (select 1 from public.bank_payments where external_id = 'AUDIT-PAY' and invoice_id = paid and match_status = 'matched') then
    raise exception 'payment was detached from a kept invoice';
  end if;

  -- 5. Faktura s odeslanou upomínkou nebo odeslaná e-mailem se nesmaže.
  insert into public.reminder_log(organization_id, invoice_id, stage, scheduled_for, sent_to, status, sent_at)
    values (org, reminded, 'on_due', current_date, 'o@example.invalid', 'sent', now());
  failed := null;
  begin
    perform public.delete_invoice_safely(org, reminded, admin);
  exception when others then failed := sqlerrm;
  end;
  if failed is distinct from 'invoice_reminder_sent' then raise exception 'reminded invoice was deleted: %', failed; end if;

  insert into public.invoice_email_deliveries(organization_id, invoice_id, action_key, request_hash, recipient, purpose, status)
    values (org, emailed, 'send-1', repeat('c', 64), 'o@example.invalid', 'manual', 'accepted');
  failed := null;
  begin
    perform public.delete_invoice_safely(org, emailed, admin);
  exception when others then failed := sqlerrm;
  end;
  if failed is distinct from 'invoice_email_sent' then raise exception 'e-mailed invoice was deleted: %', failed; end if;

  -- 6. Koncept se smaže a jeho historie v knize zůstane, včetně záznamu o smazání.
  perform public.delete_invoice_safely(org, draft, admin);
  if exists (select 1 from public.invoices where id = draft) then raise exception 'draft invoice was not deleted'; end if;
  if not exists (select 1 from public.audit_events where entity_id = draft and action = 'reminders_paused') then
    raise exception 'invoice history disappeared with the invoice';
  end if;
  if not exists (select 1 from public.audit_events where entity_id = draft and action = 'deleted'
      and actor_user_id = admin and before->>'invoice_number' = 'A-1') then
    raise exception 'invoice deletion not recorded in audit_events';
  end if;
end $$;
rollback;
