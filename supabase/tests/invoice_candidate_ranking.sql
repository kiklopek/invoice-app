\set ON_ERROR_STOP on
-- Výběr faktury u platby nabízí nahoře nejpravděpodobnější faktury: dříve
-- přiřazenou (uvolněnou), se shodou VS, se stejnou částkou, se shodou jména.
-- Jen řazení návrhů pro člověka; nic se tím nepřiřazuje.
begin;
do $$
declare
  org uuid := '00000000-0000-4000-8000-00000000c0a1';
  other_org uuid := '00000000-0000-4000-8000-00000000c0a2';
  admin uuid := '00000000-0000-4000-8000-00000000c0a3';
  released uuid; by_vs uuid; by_amount uuid; by_name uuid; unrelated_inv uuid; eur uuid;
  result jsonb; ids uuid[]; failed text;
begin
  insert into auth.users(id, email) values (admin, 'rank-admin@example.invalid');
  insert into public.organizations(id, name, ico) values (org, 'Rank test s.r.o.', '27074358'), (other_org, 'Jiná firma s.r.o.', '45274649');
  insert into public.organization_members(organization_id, user_id, email, role) values (org, admin, 'rank-admin@example.invalid', 'admin');
  insert into public.subscriptions(organization_id, status, plan, period, billing_exempt) values (org, 'active', 'business', 'yearly', true), (other_org, 'active', 'business', 'yearly', true);
  insert into public.invoices(organization_id, invoice_number, variable_symbol, counterparty_name, counterparty_email, amount_without_vat, vat_rate, amount, currency, issue_date, due_date, status, created_by)
  values
    (org, 'R-1', '1001', 'Alfa s.r.o.', 'a@example.invalid', 500, 0, 500, 'CZK', current_date, current_date + 1, 'pending', admin),
    (org, 'R-2', '0002600194', 'Beta a.s.', 'b@example.invalid', 900, 0, 900, 'CZK', current_date, current_date + 2, 'pending', admin),
    (org, 'R-3', '3003', 'Gama spol.', 'g@example.invalid', 1250, 0, 1250, 'CZK', current_date, current_date + 3, 'pending', admin),
    (org, 'R-4', '4004', 'Dřevostavby Novák s.r.o.', 'd@example.invalid', 700, 0, 700, 'CZK', current_date, current_date + 4, 'pending', admin),
    (org, 'R-5', '5005', 'Omega s.r.o.', 'o@example.invalid', 300, 0, 300, 'CZK', current_date - 40, current_date - 30, 'overdue', admin),
    (org, 'R-6', '2600194', 'Beta a.s.', 'b@example.invalid', 1250, 0, 1250, 'EUR', current_date, current_date, 'pending', admin);
  select id into released from public.invoices where invoice_number = 'R-1';
  select id into by_vs from public.invoices where invoice_number = 'R-2';
  select id into by_amount from public.invoices where invoice_number = 'R-3';
  select id into by_name from public.invoices where invoice_number = 'R-4';
  select id into unrelated_inv from public.invoices where invoice_number = 'R-5';
  select id into eur from public.invoices where invoice_number = 'R-6';

  -- Platba 1 250 CZK, VS 2600194, od „DREVOSTAVBY NOVAK“, předtím přiřazená k R-1.
  result := public.rank_open_invoice_candidates(org, admin, null, 1, 25,
    1250, 'CZK', '2600194', 'DREVOSTAVBY NOVAK', array[released]);
  select array_agg((item->>'id')::uuid order by ord) into ids from jsonb_array_elements(result->'invoices') with ordinality as x(item, ord);

  if ids[1:4] is distinct from array[released, by_vs, by_amount, by_name] then
    raise exception 'wrong order: %', (select jsonb_agg(item->>'invoice_number') from jsonb_array_elements(result->'invoices') item);
  end if;
  if ids[5] is distinct from unrelated_inv then raise exception 'unrelated invoice not last'; end if;
  if eur = any(ids) then raise exception 'other currency offered'; end if;
  if (result->>'total')::int <> 5 then raise exception 'total wrong: %', result->'total'; end if;

  -- Důvody pro štítky u faktur.
  if (select item->'match_reasons' from jsonb_array_elements(result->'invoices') item where item->>'id' = released::text) <> '["previous"]'::jsonb
    or (select item->'match_reasons' from jsonb_array_elements(result->'invoices') item where item->>'id' = by_vs::text) <> '["vs"]'::jsonb
    or (select item->'match_reasons' from jsonb_array_elements(result->'invoices') item where item->>'id' = by_amount::text) <> '["amount"]'::jsonb
    or (select item->'match_reasons' from jsonb_array_elements(result->'invoices') item where item->>'id' = by_name::text) <> '["name"]'::jsonb
    or (select item->'match_reasons' from jsonb_array_elements(result->'invoices') item where item->>'id' = unrelated_inv::text) <> '[]'::jsonb then
    raise exception 'match reasons wrong: %', result->'invoices';
  end if;

  -- Hledání dál zužuje výběr; bez platby se řadí jako dřív (podle splatnosti).
  result := public.rank_open_invoice_candidates(org, admin, 'Beta', 1, 25, null, null, null, null, null);
  if (result->>'total')::int <> 2 then raise exception 'search not applied: %', result; end if;
  result := public.rank_open_invoice_candidates(org, admin, null, 1, 25, null, null, null, null, null);
  if (result->'invoices'->0->>'id')::uuid <> unrelated_inv then raise exception 'without a payment the oldest due date is not first'; end if;

  -- Cizí firma ani klientské role nic nedostanou.
  failed := null;
  begin
    perform public.rank_open_invoice_candidates(other_org, admin, null, 1, 25, null, null, null, null, null);
  exception when others then failed := sqlerrm;
  end;
  if failed is distinct from 'insufficient_permission' then raise exception 'other organization readable: %', failed; end if;
  if has_function_privilege('authenticated', 'public.rank_open_invoice_candidates(uuid, uuid, text, integer, integer, numeric, text, text, text, uuid[])', 'EXECUTE')
    or has_function_privilege('anon', 'public.rank_open_invoice_candidates(uuid, uuid, text, integer, integer, numeric, text, text, text, uuid[])', 'EXECUTE') then
    raise exception 'client roles can call the ranking';
  end if;
end $$;
rollback;
