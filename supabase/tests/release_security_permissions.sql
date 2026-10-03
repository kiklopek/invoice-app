\set ON_ERROR_STOP on
begin;
do $$
declare f record; t record; begin
  for f in select p.oid::regprocedure signature,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in('matching_engine_version','is_learnable_account','names_match') loop
    if not coalesce(f.proconfig @> array['search_path=pg_catalog, public'],false) then raise exception 'Unpinned search path: %',f.signature; end if;
  end loop;
  for t in select tablename from pg_tables where schemaname='public' loop
    if has_table_privilege('authenticated',format('public.%I',t.tablename),'TRUNCATE') or has_table_privilege('anon',format('public.%I',t.tablename),'TRUNCATE') then
      raise exception 'Client TRUNCATE privilege: %',t.tablename;
    end if;
  end loop;
end $$;
rollback;
