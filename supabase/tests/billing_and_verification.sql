\set ON_ERROR_STOP on
-- Předplatné Splatna, objednávky a ověření firmy datovou schránkou.
begin;
do $$
declare
  hlavica uuid := gen_random_uuid();
  hlavica_admin uuid := gen_random_uuid();
  founder uuid := gen_random_uuid();
  accountant uuid := gen_random_uuid();
  org uuid;
  order_id uuid;
  result jsonb;
  status_text text;
  failed text;
  period_end timestamptz;
begin
  insert into auth.users(id, email) values
    (hlavica_admin, 'admin@hlavica.cz'), (founder, 'zakladatel@novafirma.cz'), (accountant, 'ucetni@novafirma.cz');

  -- 1) Nová firma začíná na 30denní zkušební době.
  result := public.create_organization_for_user(founder, jsonb_build_object(
    'name', 'Nová firma s.r.o.', 'ico', '27082440', 'email', 'faktury@novafirma.cz', 'bank_account_czk', '19-2000145399/0800'));
  org := (result->>'organization_id')::uuid;
  if not exists (select 1 from public.subscriptions where organization_id = org and status = 'trial'
      and trial_ends_at between now() + interval '29 days' and now() + interval '31 days') then
    raise exception 'New company has no 30-day trial';
  end if;
  insert into public.organization_members(organization_id, user_id, email, role) values (org, accountant, 'ucetni@novafirma.cz', 'accounting');

  -- 2) Objednávka jen pro ověřenou firmu a jen od administrátora.
  begin
    perform public.create_billing_order(org, founder, 'profi', 'monthly', 1, 159000, 33390, 192390, 'transfer', '{}'::jsonb);
    raise exception 'expected organization_not_verified';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'organization_not_verified' then raise exception 'Unverified company ordered: %', failed; end if;

  -- 3) Ověření kódem z datové schránky: špatný kód počítá pokusy, správný ověří.
  perform public.start_data_box_verification(org, founder, 'abc1234', repeat('a', 64), now() + interval '72 hours');
  status_text := public.verify_data_box_code(org, founder, repeat('b', 64));
  if status_text <> 'invalid' then raise exception 'Wrong code accepted: %', status_text; end if;
  begin
    perform public.verify_data_box_code(org, accountant, repeat('a', 64));
    raise exception 'expected insufficient_permission';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'insufficient_permission' then raise exception 'Non-admin verified company: %', failed; end if;
  status_text := public.verify_data_box_code(org, founder, repeat('a', 64));
  if status_text <> 'verified' then raise exception 'Correct code refused: %', status_text; end if;
  if (select verified_at from public.organizations where id = org) is null then raise exception 'Company not marked verified'; end if;

  -- 4) Po 5 chybných pokusech je kód zablokovaný i pro správnou hodnotu.
  perform public.start_data_box_verification(org, founder, 'abc1234', repeat('c', 64), now() + interval '72 hours');
  for i in 1..5 loop perform public.verify_data_box_code(org, founder, repeat('d', 64)); end loop;
  status_text := public.verify_data_box_code(org, founder, repeat('c', 64));
  if status_text <> 'locked' then raise exception 'Code not locked after 5 attempts: %', status_text; end if;

  -- 5) Částky musí sedět a tarif musí existovat.
  begin
    perform public.create_billing_order(org, founder, 'profi', 'monthly', 1, 159000, 33390, 100, 'transfer', '{}'::jsonb);
    raise exception 'expected invalid_amount';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'invalid_amount' then raise exception 'Inconsistent amount accepted: %', failed; end if;
  begin
    perform public.create_billing_order(org, accountant, 'profi', 'monthly', 1, 159000, 33390, 192390, 'transfer', '{}'::jsonb);
    raise exception 'expected insufficient_permission';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'insufficient_permission' then raise exception 'Non-admin ordered: %', failed; end if;

  -- 6) Objednávka a zaplacení: aktivace jen jednou, i když oznámení přijde dvakrát.
  result := public.create_billing_order(org, founder, 'profi', 'yearly', 12, 1526400, 320544, 1846944, 'card',
    jsonb_build_object('name', 'Nová firma s.r.o.', 'ico', '27082440', 'email', 'faktury@novafirma.cz'));
  order_id := (result->>'order_id')::uuid;
  if (result->>'variable_symbol') !~ '^[0-9]{10}$' then raise exception 'Bad variable symbol: %', result; end if;
  begin
    perform public.mark_billing_order_paid(order_id, 'comgate', 'TX-1', 100);
    raise exception 'expected amount_mismatch';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'amount_mismatch' then raise exception 'Underpayment activated plan: %', failed; end if;
  result := public.mark_billing_order_paid(order_id, 'comgate', 'TX-1', 1846944);
  if (result->>'already_paid')::boolean then raise exception 'First payment reported as duplicate'; end if;
  if (result->>'invoice_number') is null then raise exception 'No tax invoice number assigned'; end if;
  select current_period_end into period_end from public.subscriptions where organization_id = org and status = 'active' and plan = 'profi' and period = 'yearly';
  if period_end is null or period_end < now() + interval '364 days' then raise exception 'Subscription not activated for a year'; end if;
  result := public.mark_billing_order_paid(order_id, 'comgate', 'TX-1', 1846944);
  if not (result->>'already_paid')::boolean then raise exception 'Duplicate notification not detected'; end if;
  if (select current_period_end from public.subscriptions where organization_id = org) <> period_end then
    raise exception 'Duplicate notification extended the subscription';
  end if;

  -- 7) R. Hlavica (stávající firma) má trvale aktivní předplatné: migrace jí nic nevezme.
  insert into public.organizations(id, name, ico, allowed_email_domain) values (hlavica, 'R. Hlavica', '26296039', 'hlavica.cz');
  perform public.ensure_legacy_subscriptions();
  if not exists (select 1 from public.subscriptions where organization_id = hlavica and status = 'active' and current_period_end is null) then
    raise exception 'Existing company lost access';
  end if;

  -- 8) Logo firmy: povolená je jen vlastní cesta /logo/<firma>?v=…, ne cizí adresa.
  update public.organizations set logo_path = '/logo/' || org::text || '?v=1700000000000' where id = org;
  begin
    update public.organizations set logo_path = 'https://evil.example/x.png' where id = org;
    raise exception 'expected check violation';
  exception when check_violation then null;
  end;

  -- 9) Klientské role nic z toho nevolají.
  if has_function_privilege('authenticated', 'public.mark_billing_order_paid(uuid, text, text, bigint)', 'execute')
    or has_function_privilege('authenticated', 'public.verify_data_box_code(uuid, uuid, text)', 'execute')
    or has_function_privilege('anon', 'public.create_billing_order(uuid, uuid, text, text, integer, bigint, bigint, bigint, text, jsonb)', 'execute') then
    raise exception 'Client role can execute billing RPC';
  end if;
end $$;
rollback;
