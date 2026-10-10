\set ON_ERROR_STOP on
-- Trvale zdarma (R. Hlavica) je výslovný příznak, ne odvození ze stavu.
-- Stripe ho nesmí přepsat, ani když se k firmě nějak dostal zákazník.
-- Firma bez řádku předplatného už nemá vše zdarma.
begin;
do $$
declare
  exempt uuid := gen_random_uuid();
  orphan uuid := gen_random_uuid();
  admin uuid := gen_random_uuid();
  failed text;
begin
  insert into auth.users(id, email) values (admin, 'admin@hlavica.cz');
  insert into public.organizations(id, name, ico) values (exempt, 'R. Hlavica s.r.o.', '26296039'), (orphan, 'Bez předplatného', '25596641');
  insert into public.organization_members(organization_id, user_id, email, role) values (exempt, admin, 'admin@hlavica.cz', 'admin');
  insert into public.subscriptions(organization_id, status, plan, period, billing_exempt)
    values (exempt, 'active', 'business', 'yearly', true);

  -- 1) Exempt firma fakturuje.
  insert into public.invoices(organization_id, invoice_number, counterparty_name, counterparty_email,
    amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by)
  values (exempt, 'H-1', 'Odběratel', 'o@example.cz', 100, 0, 100, 'CZK', current_date, current_date, 'pending', admin);

  -- 2) Stripe zákazníka k ní nepřipojí...
  begin
    perform public.link_stripe_customer(exempt, 'cus_TEST1');
    raise exception 'expected billing_exempt';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'billing_exempt' then raise exception 'customer linked to exempt company: %', failed; end if;

  -- 3) ...a ani když zákazník už existuje, zrcadlení stav nepřepíše.
  update public.subscriptions set stripe_customer_id = 'cus_TEST1' where organization_id = exempt;
  failed := null;
  begin
    perform public.sync_stripe_subscription(exempt, jsonb_build_object(
      'status', 'trialing', 'customer_id', 'cus_TEST1', 'subscription_id', 'sub_TEST1', 'plan', 'start', 'period', 'monthly'));
    raise exception 'expected legacy_subscription';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'legacy_subscription' then raise exception 'Stripe overwrote exempt subscription: %', failed; end if;
  if not exists (select 1 from public.subscriptions where organization_id = exempt and status = 'active' and billing_exempt and stripe_subscription_id is null) then
    raise exception 'exempt subscription changed';
  end if;

  -- 4) Firma bez řádku předplatného fakturu nevystaví.
  failed := null;
  begin
    insert into public.invoices(organization_id, invoice_number, counterparty_name, counterparty_email,
      amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by)
    values (orphan, 'O-1', 'Odběratel', 'o@example.cz', 100, 0, 100, 'CZK', current_date, current_date, 'pending', admin);
    raise exception 'expected subscription_payment_required';
  exception when others then failed := sqlerrm;
  end;
  if failed <> 'subscription_payment_required' then raise exception 'company without subscription invoiced for free: %', failed; end if;

  -- 5) Příznak nemění přihlášený uživatel.
  if has_column_privilege('authenticated', 'public.subscriptions', 'billing_exempt', 'UPDATE') then
    raise exception 'authenticated may change billing_exempt';
  end if;
end $$;
rollback;
