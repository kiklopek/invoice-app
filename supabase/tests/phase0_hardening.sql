\set ON_ERROR_STOP on
-- Readiness fáze 0: nepřihlášená role anon nesmí mít k firemním datům žádné
-- právo, ani jako záložní pojistku za RLS, a nesmí ho dostat ani nová tabulka
-- vytvořená budoucí migrací. Přihlášený člen (authenticated) o čtení nepřijde.
begin;
do $$
declare t record; f record; probe_ok boolean; begin
  -- 1. Pevný search_path i u poslední privátní funkce, kterou hlásí advisor.
  if not coalesce((select p.proconfig @> array['search_path=pg_catalog, public']
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'assistance_normalize_account'), false) then
    raise exception 'Unpinned search path: private.assistance_normalize_account';
  end if;

  -- 2. anon nemá žádné právo na existující tabulky v public.
  for t in select tablename from pg_tables where schemaname = 'public' loop
    if has_table_privilege('anon', format('public.%I', t.tablename), 'SELECT')
      or has_table_privilege('anon', format('public.%I', t.tablename), 'INSERT')
      or has_table_privilege('anon', format('public.%I', t.tablename), 'UPDATE')
      or has_table_privilege('anon', format('public.%I', t.tablename), 'DELETE') then
      raise exception 'anon privilege on public.%', t.tablename;
    end if;
  end loop;

  -- 3. anon nespustí žádnou funkci v public ani private.
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') loop
    if has_function_privilege('anon', f.signature, 'EXECUTE') then
      raise exception 'anon can execute %', f.signature;
    end if;
  end loop;

  -- 4. Nová tabulka (budoucí migrace) nedostane anon právo automaticky.
  create table public.phase0_default_privilege_probe (id int);
  probe_ok := not has_table_privilege('anon', 'public.phase0_default_privilege_probe', 'SELECT');
  drop table public.phase0_default_privilege_probe;
  if not probe_ok then
    raise exception 'Default privileges still grant new public tables to anon';
  end if;

  -- 5. Regrese: přihlášený člen dál čte faktury (přístup hlídá RLS).
  if not has_table_privilege('authenticated', 'public.invoices', 'SELECT') then
    raise exception 'authenticated lost SELECT on public.invoices';
  end if;
end $$;
rollback;
