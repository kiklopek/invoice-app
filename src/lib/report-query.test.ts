import { describe, expect, it } from "vitest";
import { demoInvoices } from "./demo-data";
import { buildInvoiceReport, parseReportQuery } from "./report-query";
import type { Invoice } from "@/types/invoice";

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
    expect(report.counts).toEqual({ pending: 2, overdue: 1, paid: 1, cancelled: 0, cancelled_amount: 0 });
    expect(report.open).toBe(289570);
    expect(report.paid).toBe(297300);
    expect(report.aging.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3);
    expect(report.debtors[0].open).toBeGreaterThanOrEqual(report.debtors.at(-1)!.open);
  });

  it("adds an invoice count to every monthly bucket", () => {
    const report = buildInvoiceReport(demoInvoices, "CZK", "2026-08-06");
    expect(report.monthly.reduce((sum, month) => sum + month.count, 0)).toBe(4);
  });

  it("computes DSO only from fully paid invoices, never partial payments", () => {
    const report = buildInvoiceReport(demoInvoices, "CZK", "2026-08-06");
    const paidDemo = demoInvoices.find(invoice => invoice.status === "paid")!;
    const expectedDays = (Date.parse(paidDemo.paid_at!) - Date.parse(paidDemo.issue_date)) / 86_400_000;
    expect(report.dso.paid_invoice_count).toBe(1);
    expect(report.dso.avg_days).toBe(Math.round(expectedDays * 10) / 10);
  });

  it("ranks customer_concentration by revenue, highest first", () => {
    const report = buildInvoiceReport(demoInvoices, "CZK", "2026-08-06");
    const expectedTop = [...demoInvoices].sort((a, b) => b.amount - a.amount)[0];
    expect(report.customer_concentration[0].name).toBe(expectedTop.counterparty_name);
    for (let i = 1; i < report.customer_concentration.length; i++) {
      expect(report.customer_concentration[i - 1].revenue).toBeGreaterThanOrEqual(report.customer_concentration[i].revenue);
    }
  });

  it("sums cancelled_amount only over cancelled invoices", () => {
    const withCancelled: Invoice[] = [...demoInvoices, { ...demoInvoices[0], id: "demo-cancelled", status: "cancelled", amount: 1000, paid_amount: 0 }];
    const report = buildInvoiceReport(withCancelled, "CZK", "2026-08-06");
    expect(report.counts.cancelled).toBe(1);
    expect(report.counts.cancelled_amount).toBe(1000);
  });

  it("breaks amount down per VAT rate, summing to the same totals as the invoices", () => {
    const mixedRates: Invoice[] = [
      { ...demoInvoices[0], id: "vat-21", vat_rate: 21, amount_without_vat: 1000, amount: 1210 },
      { ...demoInvoices[0], id: "vat-0", vat_rate: 0, amount_without_vat: 500, amount: 500 },
    ];
    const report = buildInvoiceReport(mixedRates, "CZK", "2026-08-06");
    expect(report.vat_breakdown).toEqual([
      { vat_rate: 0, base: 500, tax: 0, gross: 500, count: 1 },
      { vat_rate: 21, base: 1000, tax: 210, gross: 1210, count: 1 },
    ]);
  });

  it("compares the same calendar month a year apart for yoy_monthly", () => {
    const thisYear: Invoice = { ...demoInvoices[0], id: "yoy-this-year", issue_date: "2026-03-15", amount: 1000 };
    const lastYear: Invoice = { ...demoInvoices[0], id: "yoy-last-year", issue_date: "2025-03-15", amount: 700 };
    const report = buildInvoiceReport([thisYear], "CZK", "2026-08-06", [thisYear, lastYear]);
    const march = report.yoy_monthly.find(row => row.month === "03");
    expect(march).toEqual({ month: "03", current_year: 1000, prior_year: 700 });
  });
});
