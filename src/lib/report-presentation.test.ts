import { describe, expect, it } from "vitest";
import {
  revenueRanking,
  vatMetrics,
  reportPresetRange,
  reportMetricMoney,
} from "./report-presentation";
import { buildInvoiceReport } from "./report-query";

describe("report presentation selectors", () => {
  it("sorts real customers, keeps the server remainder out of top5 and reconciles the rest", () => {
    const report = buildInvoiceReport([], "CZK", "2026-10-23");
    report.customer_concentration = Array.from({ length: 10 }, (_, index) => ({
      name: `Customer ${index}`,
      revenue: index + 1,
      count: 1,
    })).concat([{ name: "Ostatní", revenue: 500, count: 100 }]);
    const result = revenueRanking(report);
    expect(result.top.map((row) => row.revenue)).toEqual([10, 9, 8, 7, 6]);
    expect(result.top.some((row) => row.name === "Ostatní")).toBe(false);
    expect(
      result.other + result.top.reduce((sum, row) => sum + row.revenue, 0),
    ).toBe(555);
  });
  it("does not treat a real customer named Ostatní as a server aggregate", () => {
    const report = buildInvoiceReport([], "CZK", "2026-10-23");
    report.customer_concentration = [
      { name: "Ostatní", revenue: 100, count: 1 },
    ];
    expect(revenueRanking(report).top).toHaveLength(1);
  });
  it("uses only actual VAT rates, preserves cents and reconciles net plus tax with gross", () => {
    const report = buildInvoiceReport([], "EUR", "2026-10-23");
    report.vat_breakdown = [
      { vat_rate: 12, base: 100.25, tax: 12.03, gross: 112.28, count: 1 },
      { vat_rate: 0, base: 15.5, tax: 0, gross: 15.5, count: 1 },
    ];
    const metrics = vatMetrics(report);
    expect(metrics.main?.vat_rate).toBe(12);
    expect(metrics.base + metrics.tax).toBeCloseTo(127.78, 2);
    expect(metrics.otherBase).toBe(15.5);
  });
  it("handles empty and negative corrections without inventing amounts", () => {
    const report = buildInvoiceReport([], "CZK", "2026-10-23");
    expect(vatMetrics(report)).toEqual({
      main: null,
      base: 0,
      tax: 0,
      otherBase: 0,
    });
    expect(revenueRanking(report)).toEqual({ top: [], total: 0, other: 0 });
    report.vat_breakdown = [
      { vat_rate: 21, base: -100, tax: -21, gross: -121, count: 1 },
    ];
    expect(vatMetrics(report).tax).toBe(-21);
  });
  it("presets use calendar dates to today, including quarter/year boundaries", () => {
    expect(reportPresetRange("quarter", "2026-10-23")).toEqual({
      from: "2026-10-01",
      to: "2026-10-23",
    });
    expect(reportPresetRange("quarter", "2026-01-01")).toEqual({
      from: "2026-01-01",
      to: "2026-01-01",
    });
    expect(reportPresetRange("month", "2028-02-29").from).toBe("2028-02-01");
    expect(reportPresetRange("year", "2026-12-31").from).toBe("2026-01-01");
  });
  it("abbreviates large KPI amounts while retaining currency, sign and sensible rounding", () => {
    expect(reportMetricMoney(2365000, "CZK")).toBe("2,365 mil. Kč");
    expect(reportMetricMoney(0, "CZK")).toBe("0,00 Kč");
    expect(reportMetricMoney(-2365000, "EUR")).toBe("-2,365 mil. €");
    expect(reportMetricMoney(999999500, "CZK")).toBe("1 mld. Kč");
    expect(reportMetricMoney(2000000000000, "CZK")).toBe("2 bil. Kč");
  });
});
