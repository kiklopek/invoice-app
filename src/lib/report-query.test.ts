import { describe, expect, it } from "vitest";
import { demoInvoices } from "./demo-data";
import { buildInvoiceReport, parseReportQuery } from "./report-query";

describe("report query", () => {
  it("validates period and bounded filter values", () => {
    expect(parseReportQuery(new URLSearchParams("from=2026-01-01&to=2026-12-31&date_basis=paid_at&currency=CZK&status=paid&customer=Firma"))).toEqual({
      from: "2026-01-01", to: "2026-12-31", dateBasis: "paid_at", currency: "CZK", status: "paid", customer: "Firma",
    });
    expect(parseReportQuery(new URLSearchParams("from=2026-12-31&to=2026-01-01"))).toBeNull();
    expect(parseReportQuery(new URLSearchParams("from=2026-01-01&to=2026-12-31&date_basis=deleted"))).toBeNull();
  });

  it("builds stable totals, aging and debtor rows", () => {
    const report = buildInvoiceReport(demoInvoices, "CZK", "2026-08-06");
    expect(report.invoice_count).toBe(4);
    expect(report.counts).toEqual({ pending: 2, overdue: 1, paid: 1, cancelled: 0 });
    expect(report.open).toBe(289570);
    expect(report.paid).toBe(297300);
    expect(report.aging.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3);
    expect(report.debtors[0].open).toBeGreaterThanOrEqual(report.debtors.at(-1)!.open);
  });
});
