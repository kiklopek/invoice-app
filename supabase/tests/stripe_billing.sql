\set ON_ERROR_STOP on
-- Předplatné přes Stripe: firma bez karty nefakturuje, zkušební doba má
-- nejvýš 50 faktur, jedna zkušební doba na IČO i na kartu, zrcadlení stavu
-- ze Stripe nikdy tiše nepřepíše zákazníka ani předplatné.
begin;
do $$
declare
  legacy uuid := gen_random_uuid();
  legacy_admin uuid := gen_random_uuid();
  founder uuid := gen_random_uuid();
  second_founder uuid := gen_random_uuid();
  third_founder uuid := gen_random_uuid();
  org uuid;
  second_org uuid;
  third_org uuid;
  verdict text;
  failed text;
  used integer;
  synced text;
  row_value public.subscriptions%rowtype;
begin
  insert into auth.users(id, email) values
    (legacy_admin, 'admin@stara-firma.cz'), (founder, 'zakladatel@novafirma.cz'),
    (second_founder, 'jiny@druhafirma.cz'), (third_founder, 'treti@tretifirma.cz');

  -- 0) Stávající firma bez předplatného (a R. Hlavica s trvalým active) fakturuje dál.
  insert into public.organizations(id, name, ico) values (legacy, 'Stará firma s.r.o.', '25596641');
  insert into public.organization_members(organization_id, user_id, email, role) values (legacy, legacy_admin, 'admin@stara-firma.cz', 'admin');
  insert into public.invoices(organization_id, invoice_number, counterparty_name, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by)
  values (legacy, 'LEG-1', 'Odběratel', 'o@example.cz', 100, 0, 100, 'CZK', current_date, current_date, 'pending', legacy_admin);

  -- 1) Nová firma začíná bez karty (incomplete) a fakturu nevystaví.
  org := (public.create_organization_for_user(founder, jsonb_build_object(
    'name', 'Nová firma s.r.o.', 'ico', '27082440', 'email', 'faktury@novafirma.cz', 'bank_account_czk', '19-2000145399/0800'))->>'organization_id')::uuid;
  select * into row_value from public.subscriptions where organization_id = org;
  if row_value.status <> 'incomplete' or row_value.trial_invoice_limit <> 50 or row_value.trial_invoices_used <> 0 then
    raise exception 'New company subscription is not incomplete/50: %', row_to_json(row_value);
  end if;
  begin
    insert into public.invoices(organization_id, invoice_number, counterparty_name, counterparty_email,
      amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by)
    values (org, 'NF-0', 'Odběratel', 'o@example.cz', 100, 0, 100, 'CZK', current_date, current_date, 'pending', founder);
    raise exception 'expected subscription_payment_required';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'subscription_payment_required' then raise exception 'Invoice without card accepted: %', failed; end if;

  -- 2) Nárok na zkušební dobu: poprvé ano, opakovaně pro stejnou firmu stejná odpověď.
  verdict := public.claim_trial(org, 'card_fp_1', repeat('a', 64));
  if verdict <> 'eligible' then raise exception 'First trial refused: %', verdict; end if;
  verdict := public.claim_trial(org, 'card_fp_1', repeat('a', 64));
  if verdict <> 'eligible' then raise exception 'Trial claim is not idempotent: %', verdict; end if;

  -- 3) Zrcadlení ze Stripe: trialing nastaví začátek zkušební doby.
  synced := public.sync_stripe_subscription(org, jsonb_build_object(
    'customer_id', 'cus_A', 'subscription_id', 'sub_A', 'status', 'trialing', 'plan', 'profi', 'period', 'monthly',
    'trial_ends_at', now() + interval '14 days', 'current_period_end', now() + interval '14 days',
    'cancel_at_period_end', false, 'observed_at', now()));
  if synced <> 'updated' then raise exception 'Sync not applied: %', synced; end if;
  select * into row_value from public.subscriptions where organization_id = org;
  if row_value.status <> 'trialing' or row_value.trial_started_at is null or row_value.stripe_customer_id <> 'cus_A' then
    raise exception 'Trial not mirrored: %', row_to_json(row_value);
  end if;

  -- 4) Starší událost (nižší observed_at) stav nepřepíše.
  synced := public.sync_stripe_subscription(org, jsonb_build_object(
    'customer_id', 'cus_A', 'subscription_id', 'sub_A', 'status', 'incomplete', 'observed_at', now() - interval '1 hour'));
  if synced <> 'stale' or (select status from public.subscriptions where organization_id = org) <> 'trialing' then
    raise exception 'Stale event overwrote state: %', synced;
  end if;

  -- 5) Jiný zákazník nebo jiné běžící předplatné se tiše nepřepíše.
  begin
    perform public.sync_stripe_subscription(org, jsonb_build_object('customer_id', 'cus_B', 'subscription_id', 'sub_A', 'status', 'active', 'observed_at', now() + interval '1 second'));
    raise exception 'expected customer_mismatch';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'customer_mismatch' then raise exception 'Customer silently replaced: %', failed; end if;
  begin
    perform public.sync_stripe_subscription(org, jsonb_build_object('customer_id', 'cus_A', 'subscription_id', 'sub_OTHER', 'status', 'active', 'observed_at', now() + interval '1 second'));
    raise exception 'expected subscription_mismatch';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'subscription_mismatch' then raise exception 'Subscription silently replaced: %', failed; end if;
  begin
    perform public.link_stripe_customer(org, 'cus_B');
    raise exception 'expected customer_mismatch';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'customer_mismatch' then raise exception 'Customer link replaced: %', failed; end if;
  perform public.link_stripe_customer(org, 'cus_A');

  -- 6) Zkušební doba: 50 faktur projde, 51. ne; mazání faktur limit nevrací.
  insert into public.invoices(organization_id, invoice_number, counterparty_name, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by)
  select org, 'NF-' || n, 'Odběratel', 'o@example.cz', 100, 0, 100, 'CZK', current_date, current_date, 'pending', founder
  from generate_series(1, 50) n;
  select trial_invoices_used into used from public.subscriptions where organization_id = org;
  if used <> 50 then raise exception 'Trial counter is %, expected 50', used; end if;
  delete from public.invoices where organization_id = org and invoice_number = 'NF-1';
  begin
    insert into public.invoices(organization_id, invoice_number, counterparty_name, counterparty_email,
      amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by)
    values (org, 'NF-51', 'Odběratel', 'o@example.cz', 100, 0, 100, 'CZK', current_date, current_date, 'pending', founder);
    raise exception 'expected trial_invoice_limit';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'trial_invoice_limit' then raise exception '51st trial invoice accepted: %', failed; end if;

  -- 7) Po zaplacení (active) limit neplatí.
  perform public.sync_stripe_subscription(org, jsonb_build_object(
    'customer_id', 'cus_A', 'subscription_id', 'sub_A', 'status', 'active', 'plan', 'profi', 'period', 'monthly',
    'current_period_end', now() + interval '1 month', 'observed_at', now() + interval '2 seconds'));
  insert into public.invoices(organization_id, invoice_number, counterparty_name, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by)
  values (org, 'NF-52', 'Odběratel', 'o@example.cz', 100, 0, 100, 'CZK', current_date, current_date, 'pending', founder);

  -- 8) Zrušené předplatné nové faktury nepustí.
  perform public.sync_stripe_subscription(org, jsonb_build_object(
    'customer_id', 'cus_A', 'subscription_id', 'sub_A', 'status', 'canceled', 'observed_at', now() + interval '3 seconds'));
  begin
    insert into public.invoices(organization_id, invoice_number, counterparty_name, counterparty_email,
      amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by)
    values (org, 'NF-53', 'Odběratel', 'o@example.cz', 100, 0, 100, 'CZK', current_date, current_date, 'pending', founder);
    raise exception 'expected subscription_expired';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'subscription_expired' then raise exception 'Invoice after cancel accepted: %', failed; end if;
  -- ... a po zrušení smí firma začít nové předplatné (nové sub_ id).
  synced := public.sync_stripe_subscription(org, jsonb_build_object(
    'customer_id', 'cus_A', 'subscription_id', 'sub_A2', 'status', 'active', 'plan', 'start', 'period', 'yearly',
    'observed_at', now() + interval '4 seconds'));
  if synced <> 'updated' then raise exception 'New subscription after cancel refused: %', synced; end if;

  -- 9) Druhá firma se stejnou kartou zkušební dobu nedostane, IČO ani karta se nerecyklují.
  second_org := (public.create_organization_for_user(second_founder, jsonb_build_object(
    'name', 'Druhá firma s.r.o.', 'ico', '45274649', 'email', 'faktury@druhafirma.cz'))->>'organization_id')::uuid;
  verdict := public.claim_trial(second_org, 'card_fp_1', repeat('b', 64));
  if verdict <> 'card_used' then raise exception 'Same card got second trial: %', verdict; end if;
  -- IČO: firma se smaže a založí znovu se stejným IČO -> bez zkušební doby.
  delete from public.subscriptions where organization_id = org;
  delete from public.invoices where organization_id = org;
  delete from public.reminder_policies where organization_id = org;
  delete from public.organization_member_events where organization_id = org;
  delete from public.organization_members where organization_id = org;
  delete from public.organizations where id = org;
  org := (public.create_organization_for_user(founder, jsonb_build_object(
    'name', 'Nová firma znovu s.r.o.', 'ico', '27082440', 'email', 'faktury@novafirma.cz'))->>'organization_id')::uuid;
  verdict := public.claim_trial(org, 'card_fp_new', repeat('c', 64));
  if verdict <> 'ico_used' then raise exception 'Re-created company got second trial: %', verdict; end if;

  -- 10) Z jedné IP nejvýš 3 zkušební doby za 30 dní.
  third_org := (public.create_organization_for_user(third_founder, jsonb_build_object(
    'name', 'Třetí firma s.r.o.', 'ico', '00006947', 'email', 'faktury@tretifirma.cz'))->>'organization_id')::uuid;
  insert into public.trial_claims(organization_id, ico, card_fingerprint, ip_hash)
    values (null, '11111111', 'fp_x1', repeat('d', 64)), (null, '22222222', 'fp_x2', repeat('d', 64)), (null, '33333333', 'fp_x3', repeat('d', 64));
  verdict := public.claim_trial(third_org, 'fp_x4', repeat('d', 64));
  if verdict <> 'ip_limit' then raise exception 'IP limit not applied: %', verdict; end if;
  verdict := public.claim_trial(third_org, 'fp_x4', repeat('e', 64));
  if verdict <> 'eligible' then raise exception 'Other IP refused: %', verdict; end if;

  -- 11) Webhook: stejná událost se zaznamená jen jednou.
  if not public.record_stripe_event('evt_1', 'customer.subscription.updated') then raise exception 'First event refused'; end if;
  if public.record_stripe_event('evt_1', 'customer.subscription.updated') then raise exception 'Duplicate event accepted'; end if;

  -- 12) Staré funkce ručních objednávek a ověření přes datovou schránku jsou pryč.
  if to_regprocedure('public.create_billing_order(uuid,uuid,text,text,integer,bigint,bigint,bigint,text,jsonb)') is not null
    or to_regprocedure('public.verify_data_box_code(uuid,uuid,text)') is not null then
    raise exception 'Legacy billing/verification functions still exist';
  end if;

  -- 13) Klienti (anon/authenticated) nesmí nic z toho volat.
  if has_function_privilege('authenticated', 'public.claim_trial(uuid,text,text)', 'execute')
    or has_function_privilege('anon', 'public.sync_stripe_subscription(uuid,jsonb)', 'execute')
    or has_table_privilege('authenticated', 'public.trial_claims', 'select') then
    raise exception 'Client roles can reach billing internals';
  end if;
end $$;
rollback;
