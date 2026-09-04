import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260903175926_harden_auth_and_database_operations.sql"),
  "utf8",
);

describe("database hardening migration", () => {
  it("indexes every reported foreign-key access path", () => {
    const indexNames = [
      "bank_payments_imported_by_idx",
      "bank_payments_org_invoice_idx",
      "bank_payments_unmatched_by_idx",
      "invoice_events_actor_user_id_idx",
      "invoice_events_org_invoice_idx",
      "invoice_uploads_created_by_idx",
      "invoice_uploads_invoice_id_idx",
      "invoice_uploads_org_invoice_idx",
      "invoices_created_by_idx",
      "invoices_org_policy_idx",
      "invoices_reminder_policy_id_idx",
      "invoices_reminders_paused_by_idx",
      "invoices_updated_by_idx",
      "organization_member_events_actor_idx",
      "organization_members_user_id_idx",
      "reminder_automation_runs_triggered_by_idx",
      "reminder_log_org_invoice_idx",
      "reminder_settings_events_actor_idx",
    ];
    for (const name of indexNames) expect(migration).toContain(`create index if not exists ${name}`);
  });

  it("keeps internal tables inaccessible to browser roles", () => {
    expect(migration).toContain("revoke all on table public.email_mfa_challenges from public, anon, authenticated");
    expect(migration).toContain("revoke all on table public.provider_webhook_events from public, anon, authenticated");
    expect(migration).toContain("revoke all on table public.auth_request_events from public, anon, authenticated");
  });

  it("serializes and audits persistent auth rate limits", () => {
    expect(migration).toContain("create or replace function public.consume_auth_rate_limit");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("target_subject_hash !~ '^[0-9a-f]{64}$'");
    expect(migration).toContain("grant execute on function public.consume_auth_rate_limit");
  });
});
