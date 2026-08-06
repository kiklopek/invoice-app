import { describe, expect, it } from "vitest";
import { demoInvoices } from "./demo-data";
import { buildDashboardSummary } from "./dashboard-summary";

describe("dashboard summary", () => {
  it("aggregates amounts and counters without returning the complete invoice history", () => {
    const summary = buildDashboardSummary(demoInvoices);
    expect(summary.open_totals.CZK).toBe(289_570);
    expect(summary.overdue_totals.CZK).toBe(134_500);
    expect(summary.paid_totals.CZK).toBe(297_300);
    expect(summary.active_count).toBe(3);
    expect(summary.overdue_count).toBe(1);
    expect(summary.reminders_sent).toBe(3);
    expect(summary.recent).toHaveLength(4);
  });

  it("orders upcoming reminders and excludes closed invoices", () => {
    const summary = buildDashboardSummary(demoInvoices);
    expect(summary.upcoming.map(invoice => invoice.id)).toEqual(["demo-2", "demo-1", "demo-4"]);
    expect(summary.upcoming.every(invoice => invoice.status !== "paid" && invoice.status !== "cancelled")).toBe(true);
  });
});
