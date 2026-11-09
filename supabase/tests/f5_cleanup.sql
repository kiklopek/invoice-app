\set ON_ERROR_STOP on
-- Fáze F5 přestavby databáze: na fakturách nezůstávají pravidla RLS pro zápis,
-- který žádná klientská role nesmí provést (zapisuje jen server).
begin;
do $$
declare stale text;
begin
  select string_agg(policyname, ', ') into stale from pg_policies
  where schemaname = 'public' and tablename = 'invoices' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and not has_table_privilege('authenticated', 'public.invoices', case cmd when 'ALL' then 'INSERT' else cmd end);
  if stale is not null then raise exception 'Invoice write policies without a matching privilege: %', stale; end if;
  if has_table_privilege('authenticated', 'public.invoices', 'INSERT') or has_table_privilege('authenticated', 'public.invoices', 'UPDATE') then
    raise exception 'authenticated can write invoices directly';
  end if;
  if not has_table_privilege('authenticated', 'public.invoices', 'SELECT') then raise exception 'members lost read access to invoices'; end if;
end $$;
rollback;
