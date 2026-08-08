import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(join(process.cwd(), "supabase", "schema.sql"), "utf8");
const migration = readFileSync(join(process.cwd(), "supabase", "migrations", "2026080613_tenant_integrity.sql"), "utf8");
const reminderAuditMigration = readFileSync(join(process.cwd(), "supabase", "migrations", "2026080614_reminder_settings_audit.sql"), "utf8");
const accessAuditMigration = readFileSync(join(process.cwd(), "supabase", "migrations", "2026080615_access_audit.sql"), "utf8");
const reminderRecipientsMigration = readFileSync(join(process.cwd(), "supabase", "migrations", "2026080616_reminder_delivery_recipients.sql"), "utf8");
const partialPaymentsMigration = readFileSync(join(process.cwd(), "supabase", "migrations", "2026080618_partial_payments.sql"), "utf8");
const invoiceDeleteMigration = readFileSync(join(process.cwd(), "supabase", "migrations", "2026080620_safe_invoice_delete.sql"), "utf8");
const invoicePriorityMigration = readFileSync(join(process.cwd(), "supabase", "migrations", "2026080621_prioritize_open_invoices.sql"), "utf8");
const invoiceArchiveMigration = readFileSync(join(process.cwd(), "supabase", "migrations", "2026080622_invoice_archive.sql"), "utf8");
const invoiceVatMigration = readFileSync(join(process.cwd(), "supabase", "migrations", "20260808182712_add_invoice_vat_amounts.sql"), "utf8");
const reportLabelEncodingMigration = readFileSync(join(process.cwd(), "supabase", "migrations", "20260808194119_fix_report_label_encoding.sql"), "utf8");
const databaseSources = [schema, migration];

describe("database tenant integrity", () => {
  it("keeps every invoice-owned relation inside one organization", () => {
    const constraints = [
      "invoices_policy_same_org_fkey",
      "invoice_events_invoice_same_org_fkey",
      "invoice_uploads_invoice_same_org_fkey",
      "reminder_log_invoice_same_org_fkey",
      "bank_payments_invoice_same_org_fkey",
    ];
    for (const source of databaseSources) {
      for (const constraint of constraints) expect(source).toContain(constraint);
      expect(source.match(/foreign key \(organization_id, invoice_id\)/g)).toHaveLength(4);
    }
  });

  it("makes paid, closed and sent states unambiguous", () => {
    for (const source of databaseSources) {
      expect(source).toContain("invoices_paid_state_check");
      expect(source).toContain("invoices_closed_schedule_check");
      expect(source).toContain("reminder_log_sent_state_check");
      expect(source).toContain("reminder_log_provider_state_check");
    }
  });

  it("records reminder settings atomically with the authenticated actor", () => {
    for (const source of [schema, reminderAuditMigration]) {
      expect(source).toContain("create table reminder_settings_events");
      expect(source).toContain("actor_user uuid");
      expect(source).toContain("insert into reminder_settings_events");
      expect(source).toContain("role in ('accounting', 'admin')");
      expect(source).toContain("invalid_templates");
    }
    expect(reminderAuditMigration).toContain("drop function save_default_reminder_settings(uuid, integer[], jsonb, boolean)");
  });

  it("records every membership mutation in the same database transaction", () => {
    for (const source of [schema, accessAuditMigration]) {
      expect(source).toContain("create table organization_member_events");
      expect(source).toContain("create or replace function add_organization_member");
      expect(source.match(/insert into organization_member_events/g)).toHaveLength(3);
      expect(source).toContain("cannot_remove_self");
      expect(source).toContain("last_admin");
      expect(source).toContain("actor_email_value");
    }
  });

  it("validates and audits reply-to and copy recipients with reminder templates", () => {
    for (const source of [schema, reminderRecipientsMigration]) {
      expect(source).toContain("normalized_templates");
      expect(source).toContain("invalid_reply_to");
      expect(source).toContain("invalid_cc");
      expect(source).toContain("cardinality(cc_values) > 5");
      expect(source).toContain("reply_to = excluded.reply_to");
      expect(source).toContain("cc = excluded.cc");
      expect(source).toContain("new_days, normalized_templates");
    }
  });

  it("supports multiple partial bank payments without overstating receivables", () => {
    for (const source of [schema, partialPaymentsMigration]) {
      expect(source).toContain("paid_amount numeric(14,2)");
      expect(source).toContain("invoices_payment_balance_state_check");
      expect(source).toContain("create or replace function unassign_bank_payment");
      expect(source.replace(/\s/g, "")).toContain("amount-paid_amount");
      expect(source).toContain("'settlement'");
      expect(source).toContain("'partial'");
    }
    expect(partialPaymentsMigration).toContain("drop index if exists bank_payments_one_match_per_invoice");
  });

  it("stores net, VAT rate and gross invoice amounts consistently", () => {
    for (const source of [schema, invoiceVatMigration]) {
      expect(source).toContain("amount_without_vat numeric(14,2)");
      expect(source).toContain("vat_rate numeric(5,2)");
      expect(source).toContain("invoices_vat_amounts_consistent");
      expect(source).toContain("amount_without_vat, i.vat_rate, i.amount");
    }
  });

  it("keeps Czech aging labels safe across SQL client encodings", () => {
    expect(reportLabelEncodingMigration).toContain("U&'P\\0159ed splatnost\\00ED'");
    expect(reportLabelEncodingMigration).toContain("U&'1\\20137 dn\\00ED'");
    expect(reportLabelEncodingMigration).toContain("U&'V\\00EDce ne\\017E 30 dn\\00ED'");
    expect(reportLabelEncodingMigration).not.toMatch(/PĹ|dnĂ|â€“|VĂ/);
  });

  it("deletes invoices atomically while preserving unmatched bank payments", () => {
    for (const source of [schema, invoiceDeleteMigration]) {
      expect(source).toContain("function delete_invoice_safely");
      expect(source).toContain("match_status = 'unmatched'");
      expect(source).toContain("delete from invoices");
      expect(source).toContain("role in ('accounting', 'admin')");
    }
  });

  it("keeps invoices requiring action ahead of the closed archive", () => {
    for (const source of [schema, invoicePriorityMigration]) {
      expect(source).toContain("when 'overdue' then 0 when 'pending' then 1 when 'paid' then 2 else 3");
      expect(source).toContain("case when status in ('overdue', 'pending') then due_date end asc nulls last");
      expect(source).toContain("case when status = 'paid' then paid_at end desc nulls last");
    }
  });

  it("provides a server-side archive across paid and cancelled invoices", () => {
    for (const source of [schema, invoiceArchiveMigration]) {
      expect(source).toContain("'paid', 'cancelled', 'closed'");
      expect(source).toContain("status_filter = 'closed' and i.status in ('paid', 'cancelled')");
    }
  });
});
