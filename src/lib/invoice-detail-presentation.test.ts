import { describe, expect, it } from "vitest";
import { invoiceDetailView } from "@/app/(workspace)/invoices/[id]/invoice-detail-view";
import type { Invoice } from "@/types/invoice";
const invoice = { amount: 266189, amount_without_vat: 219990.91, paid_amount: 0, status: "pending", reminders_paused: false } as Invoice;
describe("invoice detail financial presentation", () => {
  it("keeps gross total distinct from net and computes the displayed VAT difference in cents", () => {
    expect(invoiceDetailView(invoice)).toMatchObject({ remaining: 266189, vatAmount: 46198.09, label: "Čeká na úhradu" });
    expect(invoice.amount).toBe(266189);
  });
  it("shows partial settlement without hiding the actual overdue state in the model", () => {
    expect(invoiceDetailView({ ...invoice, status: "overdue", paid_amount: 120000.01 })).toMatchObject({ partial: true, remaining: 146188.99, label: "Částečně uhrazeno", remindersActive: true });
  });
  it.each(["paid", "cancelled"] as const)("never offers an active reminder for %s invoices", status => {
    expect(invoiceDetailView({ ...invoice, status, next_reminder_at: "2026-11-01" })).toMatchObject({ open: false, remindersActive: false });
  });
  it("respects paused reminders and does not reinterpret a cancelled partial balance", () => {
    expect(invoiceDetailView({ ...invoice, reminders_paused: true }).remindersActive).toBe(false);
    expect(invoiceDetailView({ ...invoice, status: "cancelled", paid_amount: 100 }).label).toBe("Stornováno");
  });
  it("avoids binary rounding loss for exact partial balances", () => {
    expect(invoiceDetailView({ ...invoice, amount: .3, amount_without_vat: .1, paid_amount: .1 })).toMatchObject({ remaining: .2, vatAmount: .2 });
  });
});
