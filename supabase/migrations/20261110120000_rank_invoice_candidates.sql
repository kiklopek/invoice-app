-- Výběr faktury u platby: nejpravděpodobnější faktury nahoře.
--
-- Nová funkce vedle list_open_invoice_candidates (ta zůstává beze změny).
-- Jen řadí otevřené faktury pro člověka, nic nepřiřazuje. Pořadí:
--   1. previous – faktura dříve přiřazená k této platbě (např. po uvolnění)
--      nebo navržená automatikou (prefer_invoice_ids),
--   2. vs       – variabilní symbol se shoduje (bez úvodních nul),
--   3. amount   – zbývající částka faktury = částka platby,
--   4. name     – jméno plátce odpovídá odběrateli (private.names_match, nebo
--                 hlavní slovo jména odběratele ve jméně plátce),
--   pak splatnost jako dřív. Faktury v jiné měně než platba se nenabízejí.

-- Stejně jako zaúčtování (reconcile_bank_statement, guard_automatic_payment)
-- a TS normalizeVariableSymbol: bez mezer a úvodních nul; samé nuly = žádný VS.
-- Shodu hlídá src/lib/matching-parity.test.ts.
create or replace function private.normalize_vs(raw text) returns text
language sql immutable set search_path = '' as $$
  select nullif(ltrim(regexp_replace(coalesce(raw, ''), '\s', '', 'g'), '0'), '');
$$;

create or replace function private.name_key(raw text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(upper(translate(coalesce(raw, ''),
    'áàâãäåčćçďéèêëěíìîïĺľňñóòôõöŕřšśťúùûůüýÿžźżÁÀÂÃÄÅČĆÇĎÉÈÊËĚÍÌÎÏĹĽŇÑÓÒÔÕÖŔŘŠŚŤÚÙÛŮÜÝŸŽŹŻ',
    'aaaaaacccdeeeeeiiiillnnooooorrsstuuuuuyyzzzAAAAAACCCDEEEEEIIIILLNNOOOOORRSSTUUUUUYYZZZ')), '[^A-Z0-9 ]', ' ', 'g');
$$;

-- Hlavní slovo jména odběratele (nejdelší slovo z aspoň 4 znaků, bez právních forem).
create or replace function private.loose_name_match(payer text, counterparty text) returns boolean
language sql immutable set search_path = '' as $$
  select exists (
    select 1 from regexp_split_to_table(private.name_key(counterparty), '\s+') word
    where length(word) >= 4 and word not in ('SRO', 'SPOL', 'AKCIOVA', 'SPOLECNOST', 'DRUZSTVO')
      and position(word in private.name_key(payer)) > 0
  );
$$;

create or replace function public.rank_open_invoice_candidates(
  target_org uuid, actor_user uuid, search_query text default null, page_number integer default 1, page_size integer default 25,
  payment_amount numeric default null, payment_currency text default null, payment_vs text default null,
  payment_name text default null, prefer_invoice_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result jsonb;
  vs text := private.normalize_vs(payment_vs);
  payer text := nullif(trim(payment_name), '');
begin
  if not exists (select 1 from public.organization_members where organization_id = target_org and user_id = actor_user and role in ('accounting', 'admin')) then
    raise exception 'insufficient_permission';
  end if;
  if page_number < 1 or page_size < 1 or page_size > 50 or length(coalesce(search_query, '')) > 100
    or length(coalesce(payment_name, '')) > 200 or length(coalesce(payment_vs, '')) > 20 or cardinality(coalesce(prefer_invoice_ids, '{}')) > 20 then
    raise exception 'invalid_request';
  end if;
  with filtered as materialized (
    select i.id, i.invoice_number, i.counterparty_name, i.counterparty_ico, i.variable_symbol, i.amount, i.paid_amount, i.currency, i.due_date,
      array_remove(array[
        case when i.id = any(coalesce(prefer_invoice_ids, '{}')) then 'previous' end,
        case when vs is not null and private.normalize_vs(i.variable_symbol) = vs then 'vs' end,
        case when payment_amount is not null and i.amount - i.paid_amount = payment_amount then 'amount' end,
        case when payer is not null and (private.names_match(payer, i.counterparty_name) or private.loose_name_match(payer, i.counterparty_name)) then 'name' end
      ], null) as reasons
    from public.invoices i
    where i.organization_id = target_org and i.status in ('pending', 'overdue')
      and (nullif(trim(payment_currency), '') is null or i.currency = upper(trim(payment_currency)))
      and (nullif(trim(search_query), '') is null or i.invoice_number ilike '%' || trim(search_query) || '%'
        or i.counterparty_name ilike '%' || trim(search_query) || '%' or coalesce(i.counterparty_ico, '') ilike '%' || trim(search_query) || '%'
        or coalesce(i.variable_symbol, '') ilike '%' || trim(search_query) || '%')
  ), scored as (
    select f.*, (case when 'previous' = any(reasons) then 1000 else 0 end
      + case when 'vs' = any(reasons) then 400 else 0 end
      + case when 'amount' = any(reasons) then 300 else 0 end
      + case when 'name' = any(reasons) then 200 else 0 end) as score
    from filtered f
  ), paged as (
    select * from scored order by score desc, due_date, id offset (page_number - 1) * page_size limit page_size
  )
  select jsonb_build_object(
    'invoices', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'invoice_number', p.invoice_number, 'counterparty_name', p.counterparty_name, 'counterparty_ico', p.counterparty_ico,
        'variable_symbol', p.variable_symbol, 'amount', p.amount, 'paid_amount', p.paid_amount, 'currency', p.currency,
        'due_date', p.due_date, 'match_reasons', to_jsonb(p.reasons)) order by p.score desc, p.due_date, p.id) from paged p), '[]'::jsonb),
    'total', (select count(*) from filtered), 'page', page_number, 'page_size', page_size) into result;
  return result;
end $function$;

revoke all on function private.normalize_vs(text) from public, anon, authenticated;
revoke all on function private.name_key(text) from public, anon, authenticated;
revoke all on function private.loose_name_match(text, text) from public, anon, authenticated;
revoke all on function public.rank_open_invoice_candidates(uuid, uuid, text, integer, integer, numeric, text, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.rank_open_invoice_candidates(uuid, uuid, text, integer, integer, numeric, text, text, text, uuid[]) to service_role;
