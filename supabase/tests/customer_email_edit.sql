\set ON_ERROR_STOP on
begin;
do $$
declare
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  actor uuid := gen_random_uuid(); other_actor uuid := gen_random_uuid(); viewer uuid := gen_random_uuid();
  customer uuid; open_invoice uuid := gen_random_uuid(); partial_invoice uuid := gen_random_uuid();
  paid_invoice uuid := gen_random_uuid(); cancelled_invoice uuid := gen_random_uuid();
  result jsonb;
begin
  insert into auth.users(id, email) values (actor, actor::text || '@hlavica.cz'), (other_actor, other_actor::text || '@hlavica.cz'), (viewer, viewer::text || '@hlavica.cz');
  insert into public.organizations(id, name, ico) values (org, 'Contact fixture', '12345678'), (other_org, 'Other fixture', '12345678');
  insert into public.organization_members(organization_id, user_id, email, role) values
    (org, actor, actor::text || '@hlavica.cz', 'accounting'),
    (other_org, other_actor, other_actor::text || '@hlavica.cz', 'admin'),
    (org, viewer, viewer::text || '@hlavica.cz', 'viewer');

  insert into public.invoices(id, organization_id, invoice_number, counterparty_name, counterparty_ico, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, created_by)
  values
    (open_invoice, org, 'CONTACT-1', 'Customer', '87654321', 'old@example.cz', 100, 0, 100, 'CZK', current_date, current_date, actor),
    (partial_invoice, org, 'CONTACT-2', 'Customer', '87654321', 'old@example.cz', 100, 0, 100, 'CZK', current_date - 10, current_date - 1, actor),
    (paid_invoice, org, 'CONTACT-3', 'Customer', '87654321', 'old@example.cz', 100, 0, 100, 'CZK', current_date, current_date, actor),
    (cancelled_invoice, org, 'CONTACT-4', 'Customer', '87654321', 'old@example.cz', 100, 0, 100, 'CZK', current_date, current_date, actor),
    (gen_random_uuid(), org, 'CONTACT-5', 'Another customer', '87654322', 'unrelated@example.cz', 100, 0, 100, 'CZK', current_date, current_date, actor),
    (gen_random_uuid(), other_org, 'CONTACT-1', 'Other org customer', '87654321', 'other@example.cz', 100, 0, 100, 'CZK', current_date, current_date, other_actor);
  select customer_id into customer from public.invoices where id = open_invoice;
  perform public.confirm_manual_payment(org, partial_invoice, actor, 40, current_date);
  perform public.confirm_manual_payment(org, paid_invoice, actor, 100, current_date);
  update public.invoices set status = 'cancelled' where id = cancelled_invoice;

  result := public.update_customer_contact(org, actor, customer, true, ' NEW@EXAMPLE.CZ ', true, ' 123 ');
  if (result->>'updated_invoice_count')::integer <> 2 then raise exception 'Incorrect invoice count: %', result; end if;
  if not exists(select 1 from public.customers where id = customer and email = 'new@example.cz' and phone = '123') then raise exception 'Contact not updated'; end if;
  if (select count(*) from public.invoices where id in(open_invoice, partial_invoice) and counterparty_email = 'new@example.cz') <> 2 then raise exception 'Open recipients not updated'; end if;
  if (select paid_amount from public.invoices where id = partial_invoice) <> 40 then raise exception 'Partial payment changed'; end if;
  if (select count(*) from public.invoices where id in(paid_invoice, cancelled_invoice) and counterparty_email = 'old@example.cz') <> 2 then raise exception 'Closed recipients changed'; end if;
  if not exists(select 1 from public.invoices where organization_id = other_org and counterparty_email = 'other@example.cz') then raise exception 'Other organization changed'; end if;
  if not exists(select 1 from public.invoices where organization_id = org and counterparty_ico = '87654322' and counterparty_email = 'unrelated@example.cz') then raise exception 'Other customer changed'; end if;

  -- A later document must not overwrite the explicitly saved contact.
  update public.invoices set counterparty_email = 'document@example.cz' where id = paid_invoice;
  if (select email from public.customers where id = customer) <> 'new@example.cz' then raise exception 'Import overwrote contact'; end if;
  perform public.update_customer_contact(org, actor, customer, false, null, true, null);
  if not exists(select 1 from public.customers where id = customer and email = 'new@example.cz' and phone is null) then raise exception 'Phone-only update changed email'; end if;
  if public.update_customer_contact(other_org, other_actor, customer, true, 'cross@example.cz') is not null then raise exception 'Cross-org contact visible'; end if;

  begin
    perform public.update_customer_contact(org, viewer, customer, true, 'viewer@example.cz');
    raise exception 'Viewer update accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.update_customer_contact(org, other_actor, customer, true, 'cross@example.cz');
    raise exception 'Cross-org actor accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.update_customer_contact(org, actor, customer, true, '');
    raise exception 'Blank email accepted';
  exception when invalid_parameter_value then null; end;

  -- Force the invoice write to fail after the customer update and prove rollback.
  alter table public.invoices add constraint contact_test_failure check(counterparty_email <> 'rollback@example.cz');
  begin
    perform public.update_customer_contact(org, actor, customer, true, 'rollback@example.cz');
    raise exception 'Expected invoice failure';
  exception when check_violation then null; end;
  if (select email from public.customers where id = customer) <> 'new@example.cz' then raise exception 'Partial contact write survived failure'; end if;
  if exists(select 1 from public.invoices where organization_id = org and counterparty_email = 'rollback@example.cz') then raise exception 'Partial invoice write survived failure'; end if;

  if has_function_privilege('anon', 'public.update_customer_contact(uuid,uuid,uuid,boolean,text,boolean,text)', 'execute')
    or has_function_privilege('authenticated', 'public.update_customer_contact(uuid,uuid,uuid,boolean,text,boolean,text)', 'execute') then raise exception 'RPC exposed to public roles'; end if;
end $$;
rollback;
