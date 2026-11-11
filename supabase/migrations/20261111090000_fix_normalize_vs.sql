-- Oprava private.normalize_vs (zavedena v 20261110120000_rank_invoice_candidates).
--
-- Původní verze zahazovala všechny nečíselné znaky, takže „VS 2600194“ se ve
-- výběru faktury řadil jako shoda VS, i když ho zaúčtování
-- (reconcile_bank_statement, guard_automatic_payment) ani náhled v TS
-- (normalizeVariableSymbol) za VS nepovažují. Teď odstraní jen mezery a úvodní
-- nuly jako zaúčtování; samé nuly = žádný VS. Shodu hlídá
-- src/lib/matching-parity.test.ts. Týká se jen řazení návrhů, nic nepřiřazuje.
create or replace function private.normalize_vs(raw text) returns text
language sql immutable set search_path = '' as $$
  select nullif(ltrim(regexp_replace(coalesce(raw, ''), '\s', '', 'g'), '0'), '');
$$;
revoke all on function private.normalize_vs(text) from public, anon, authenticated;
