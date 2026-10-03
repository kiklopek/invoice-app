-- Preserve client SELECT/RLS and server writes. TRUNCATE bypasses RLS and
-- is never part of the application's browser contract.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

alter function private.matching_engine_version() set search_path = pg_catalog, public;
alter function private.is_learnable_account(text) set search_path = pg_catalog, public;
alter function private.names_match(text,text) set search_path = pg_catalog, public;
