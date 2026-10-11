\set ON_ERROR_STOP on
-- Fronta upomínek je férová mezi firmami: dávka 25 se rozdělí po firmách
-- (každá dostane svůj díl), ne podle toho, kdo má nejstarší frontu. Dřív
-- jedna firma s 200 upomínkami zabrala celý denní běh všem ostatním.
begin;
do $$
declare
  big uuid := gen_random_uuid(); small uuid := gen_random_uuid(); actor uuid := gen_random_uuid();
  inv uuid; claimed integer; small_claimed integer;
begin
  insert into auth.users(id, email) values (actor, 'fair@example.cz');
  insert into public.organizations(id, name, ico) values (big, 'Velká', '27082440'), (small, 'Malá', '25596641');
  insert into public.subscriptions(organization_id, status, plan, period, billing_exempt)
    values (big, 'active', 'business', 'yearly', true), (small, 'active', 'business', 'yearly', true);
  for i in 1..40 loop
    insert into public.invoices(organization_id, invoice_number, counterparty_name, counterparty_email,
      amount_without_vat, vat_rate, amount, currency, issue_date, due_date, created_by)
    values (big, 'B-' || i, 'Odběratel', 'b' || i || '@example.cz', 100, 0, 100, 'CZK', current_date - 30, current_date - 20, actor)
    returning id into inv;
    insert into public.reminder_log(organization_id, invoice_id, stage, scheduled_for, sent_to)
      values (big, inv, 'overdue', current_date - 10, 'b' || i || '@example.cz');
  end loop;
  for i in 1..3 loop
    insert into public.invoices(organization_id, invoice_number, counterparty_name, counterparty_email,
      amount_without_vat, vat_rate, amount, currency, issue_date, due_date, created_by)
    values (small, 'S-' || i, 'Odběratel', 's' || i || '@example.cz', 100, 0, 100, 'CZK', current_date - 3, current_date - 1, actor)
    returning id into inv;
    insert into public.reminder_log(organization_id, invoice_id, stage, scheduled_for, sent_to)
      values (small, inv, 'overdue', current_date, 's' || i || '@example.cz');
  end loop;

  select count(*), count(*) filter (where organization_id = small) into claimed, small_claimed
    from public.claim_reminder_jobs(array[big, small], gen_random_uuid(), 25, 900, now());
  if claimed <> 25 then raise exception 'batch size changed: %', claimed; end if;
  if small_claimed <> 3 then raise exception 'small company starved by the big one: % of 3', small_claimed; end if;
end $$;
rollback;
