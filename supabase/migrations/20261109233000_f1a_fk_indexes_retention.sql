-- Fáze F1a přestavby databáze (návrh: Splatno – návrh přestavby databázové architektury).
--
-- 1. Index na každý cizí klíč, který ho neměl (20, hlášeno Supabase advisorem
--    unindexed_foreign_keys 9. 11. 2026). Zrychlí mazání a spojení přes vazbu;
--    tabulky jsou malé, vytvoření je okamžité.
-- 2. Doba uchování technických záznamů. Maže jen: použité/propadlé MFA kódy
--    (24 h po vypršení), webhooky Resend a Stripe (90 dní; ochrana proti
--    opakování potřebuje dny) a opuštěné koncepty onboardingu (90 dní bez
--    změny). Nikdy nemaže faktury, platby, audit ani nic s penězi.
--    auth_request_events už maže funkce omezení pokusů (30 dní), proto tu není.
--
-- Test: supabase/tests/f1_indexes_retention.sql

create index if not exists bank_statement_entries_overlap_acknowledged_by_idx on public.bank_statement_entries (overlap_acknowledged_by);
create index if not exists bank_statement_imports_discarded_by_idx on public.bank_statement_imports (discarded_by);
create index if not exists billing_orders_created_by_idx on public.billing_orders (created_by);
create index if not exists customers_created_by_idx on public.customers (created_by);
create index if not exists customers_updated_by_idx on public.customers (updated_by);
create index if not exists invoice_email_action_keys_delivery_id_idx on public.invoice_email_action_keys (delivery_id);
create index if not exists invoice_email_action_keys_invoice_id_idx on public.invoice_email_action_keys (invoice_id);
create index if not exists invoice_email_deliveries_invoice_id_idx on public.invoice_email_deliveries (invoice_id);
create index if not exists invoices_customer_id_idx on public.invoices (customer_id);
create index if not exists notification_reads_organization_id_event_id_idx on public.notification_reads (organization_id, event_id);
create index if not exists operator_actions_order_id_idx on public.operator_actions (order_id);
create index if not exists operator_actions_organization_id_idx on public.operator_actions (organization_id);
create index if not exists organization_bank_accounts_created_by_idx on public.organization_bank_accounts (created_by);
create index if not exists organization_members_invited_by_idx on public.organization_members (invited_by);
create index if not exists organization_verifications_created_by_idx on public.organization_verifications (created_by);
create index if not exists organizations_created_by_idx on public.organizations (created_by);
create index if not exists payment_assistance_events_actor_user_idx on public.payment_assistance_events (actor_user);
create index if not exists payment_assistance_proposals_decided_by_idx on public.payment_assistance_proposals (decided_by);
create index if not exists payment_payer_memory_confirmed_by_idx on public.payment_payer_memory (confirmed_by);
create index if not exists support_sessions_ended_by_idx on public.support_sessions (ended_by);

create or replace function private.apply_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mfa integer; webhooks integer; stripe integer; drafts integer;
begin
  delete from public.email_mfa_challenges where expires_at < now() - interval '24 hours';
  get diagnostics mfa = row_count;
  delete from public.provider_webhook_events where received_at < now() - interval '90 days';
  get diagnostics webhooks = row_count;
  delete from public.stripe_events where received_at < now() - interval '90 days';
  get diagnostics stripe = row_count;
  delete from public.onboarding_drafts where updated_at < now() - interval '90 days';
  get diagnostics drafts = row_count;
  return jsonb_build_object(
    'email_mfa_challenges', mfa, 'provider_webhook_events', webhooks,
    'stripe_events', stripe, 'onboarding_drafts', drafts, 'ran_at', now());
end $$;

revoke all on function private.apply_retention() from public, anon, authenticated;
grant execute on function private.apply_retention() to service_role;

-- Denní běh v databázi (pg_cron). Lokální testovací harness pg_cron nemá,
-- proto podmínka; na Supabase je rozšíření k dispozici.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.unschedule(jobid) from cron.job where jobname = 'splatno-data-retention';
    perform cron.schedule('splatno-data-retention', '17 3 * * *', 'select private.apply_retention()');
  end if;
end $$;
