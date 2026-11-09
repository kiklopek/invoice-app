-- Readiness fáze 0: druhá pojistka za RLS pro nepřihlášenou roli anon.
--
-- Stav před migrací (ověřeno na produkci 13. 10. 2026):
-- * anon měla SELECT na 13 tabulkách v public (invoices, bank_payments,
--   organizations, organization_members, …). Data chránilo jen RLS bez anon
--   politik. Aplikace s rolí anon žádnou tabulku nečte (čtení vždy až po
--   ověření session), takže odebrání nic nemění pro uživatele.
-- * Výchozí oprávnění schématu public dávala anon plná práva na KAŽDOU novou
--   tabulku, funkci i sekvenci. Budoucí tabulka bez zapnutého RLS by tak byla
--   čitelná i zapisovatelná bez přihlášení.
-- * private.assistance_normalize_account neměla pevný search_path (advisor
--   function_search_path_mutable). Tělo používá jen vestavěné funkce, mění se
--   pouze konfigurace, ne tělo ani GRANTy.
-- * Tři privátní pomocné funkce měly výchozí EXECUTE pro PUBLIC (a tím anon).
--   Přihlášený uživatel a service_role o ně nepřijdou.
--
-- Test: supabase/tests/phase0_hardening.sql

alter function private.assistance_normalize_account(text) set search_path = pg_catalog, public;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;

revoke execute on function private.is_learnable_account(text) from public, anon;
revoke execute on function private.matching_engine_version() from public, anon;
revoke execute on function private.names_match(text, text) from public, anon;
grant execute on function private.is_learnable_account(text) to authenticated, service_role;
grant execute on function private.matching_engine_version() to authenticated, service_role;
grant execute on function private.names_match(text, text) to authenticated, service_role;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
