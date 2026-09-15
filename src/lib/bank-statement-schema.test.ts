import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260915095449_add_bank_statement_imports.sql",
  ),
  "utf8",
);
const foreignKeyIndexes = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260915095546_index_bank_statement_foreign_keys.sql",
  ),
  "utf8",
);
const unifyLedger = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260916000000_unify_payment_ledger.sql",
  ),
  "utf8",
);

describe("bank statement migration", () => {
  it.each([
    "bank_statement_imports",
    "bank_statement_entries",
    "bank_payment_allocations",
    "counterparty_payment_accounts",
  ])("creates additive table %s", (table) => {
    expect(migration).toContain(`create table public.${table}`);
  });

  it("enforces organization boundaries, roles, atomic locks and idempotency", () => {
    expect(migration).toContain("bank_payments_org_id_unique");
    expect(migration).toContain("private.is_org_member(organization_id)");
    expect(migration).toContain("foreign key(organization_id,invoice_id)");
    expect(migration).toContain("role in('accounting','admin')");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("if selected_import.status='committed'");
    expect(migration).toContain("for update of invoice");
  });

  it("keeps and backfills the legacy bank payment relation", () => {
    expect(migration).toContain(
      "Backfill the legacy one-payment-to-one-invoice relationships",
    );
    expect(migration).not.toContain("drop column");
  });

  it("covers GPC foreign keys used by commits and cleanup", () => {
    expect(foreignKeyIndexes.match(/create index if not exists/g)).toHaveLength(9);
    expect(foreignKeyIndexes).toContain("bank_statement_entries_org_import_idx");
    expect(foreignKeyIndexes).toContain("bank_payment_allocations_org_payment_idx");
  });
});

describe("unified payment ledger migration", () => {
  it("distinguishes a fully committed multi-invoice split from a genuinely ambiguous payment", () => {
    expect(unifyLedger).toContain("match_status in ('matched', 'split', 'unmatched', 'ambiguous')");
    expect(unifyLedger).toContain("(match_status = 'split' and invoice_id is null and matched_at is not null)");
    expect(unifyLedger).toContain("when count(allocation.id)>1 and sum(allocation.amount)=entry.amount then 'split'");
  });

  it("tags where a payment came from so manual confirmations share the same ledger", () => {
    expect(unifyLedger).toContain("add column if not exists source text not null default 'bank_import'");
    expect(unifyLedger).toContain("check (source in ('bank_import', 'manual'))");
  });

  it("cleans up bank_payment_allocations when deleting or reopening an invoice, not just legacy bank_payments", () => {
    expect(unifyLedger).toContain("create or replace function delete_invoice_safely");
    expect(unifyLedger).toContain("create or replace function reopen_paid_invoice");
    for (const fn of ["delete_invoice_safely", "reopen_paid_invoice"]) {
      const start = unifyLedger.indexOf(`create or replace function ${fn}`);
      const body = unifyLedger.slice(start, start + 3000);
      expect(body).toContain("delete from bank_payment_allocations");
      expect(body).toContain("is_committed and bank_payment_id is not null");
    }
  });

  it("records a manual 'Potvrdit úhradu' confirmation as a ledger entry instead of overwriting paid_amount directly", () => {
    expect(unifyLedger).toContain("create or replace function confirm_manual_payment");
    expect(unifyLedger).toContain("'manual:' || gen_random_uuid()::text");
    expect(unifyLedger).toContain("'manual', actor_user, now()");
    expect(unifyLedger).toContain("insert into bank_payment_allocations");
    expect(unifyLedger).toContain("grant execute on function confirm_manual_payment(uuid, uuid, uuid, numeric, date) to service_role");
  });
});
