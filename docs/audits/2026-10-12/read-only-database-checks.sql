-- Proposed read-only checks. Not executed: the connector's automatic review
-- rejected exporting private definitions and statement metadata without
-- explicit approval. No DDL, user records, tokens, raw query text or writes.

select n.nspname as schema_name, p.proname as function_name,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private'
  and p.proname in ('is_org_member', 'has_org_role', 'assistance_normalize_account');

select queryid, calls,
       round(mean_exec_time::numeric, 3) as mean_execution_ms,
       round(max_exec_time::numeric, 3) as max_execution_ms,
       rows
from extensions.pg_stat_statements
where query like '%organization_members%'
   or query like '%organization_member_events%'
   or query like '%support_sessions%'
order by total_exec_time desc
limit 20;
