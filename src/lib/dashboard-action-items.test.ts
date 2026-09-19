import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const client = () => source("src/app/(workspace)/dashboard/dashboard-client.tsx");
const rpc = () => source("supabase/migrations/20260919140000_dashboard_action_items.sql");

describe("dashboard \"co dělat dnes\"", () => {
  it("hides the section entirely when every count is zero", () => {
    expect(client()).toContain("actionItems.length > 0 && (");
    expect(client()).toContain(".filter((item): item is Exclude<typeof item, false> => item !== false)");
  });

  it("links each item straight to where it gets resolved", () => {
    const source = client();
    expect(source).toContain('href: "/invoices/payments/archive"');
    expect(source).toContain('href: "/invoices/import"');
    expect(source).toContain('href: "/reminders"');
  });

  it("counts payments needing review by proposal_confidence, not by whether a bank_payment row exists", () => {
    // The automatic pass books a bank_payments row for every accepted entry
    // regardless of outcome (matched, split, ambiguous, unmatched) -- so
    // bank_payment_id being set is not a signal that nothing needs a look.
    // Mirrors payment_reconciliation_summary's own needs_review definition.
    const sql = rpc();
    expect(sql).toContain("disposition = 'accepted'");
    expect(sql).toContain("(proposal_confidence = 'review' or proposal_confidence is null)");
    expect(sql).not.toContain("bank_payment_id is null");
  });

  it("scopes the OCR count to uploads that have not expired", () => {
    const sql = rpc();
    expect(sql).toContain("ocr_status = 'succeeded' and invoice_id is null and expires_at > now()");
  });

  it("counts reminders due today or tomorrow independently of the capped upcoming list", () => {
    // upcoming's own CTE caps at 4 rows for display; a live count must not
    // reuse that limit or it would silently stop growing past 4.
    const sql = rpc();
    expect(sql).toContain("next_reminder_at::date <= ((now() at time zone 'Europe/Prague')::date + 1)");
  });

  it("adds the three counts as new keys without touching any existing key", () => {
    const sql = rpc();
    for (const existingKey of ["open_totals", "overdue_totals", "paid_totals", "active_count", "overdue_count", "reminders_sent", "recent", "upcoming"]) {
      expect(sql).toContain(`'${existingKey}'`);
    }
  });
});
