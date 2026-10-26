import { describe, expect, it } from "vitest";
import { emptyDashboardData } from "@/lib/dashboard-summary";
import {
  dashboardBeforeDue,
  dashboardComparisonRange,
  dashboardCountChange,
  dashboardAmountSearchHref,
  dashboardMonthlyStatuses,
  dashboardTrendGroups,
  dashboardReportRange,
  dashboardStatusParts,
} from "./dashboard-presentation";

describe("dashboard presentation contracts", () => {
  it("separates invoices before due from overdue counts and balances per currency", () => {
    const before = dashboardBeforeDue({
      ...emptyDashboardData, active_count: 5, overdue_count: 2,
      open_totals: { CZK: 1000.31, EUR: 250.15 },
      overdue_totals: { CZK: 300.1 },
    });
    expect(before).toEqual({ count: 3, totals: { CZK: 700.21, EUR: 250.15 } });
  });
  it("shows zero before due when all open invoices are overdue, without duplicating them", () => {
    expect(dashboardBeforeDue({
      ...emptyDashboardData, active_count: 35, overdue_count: 35,
      open_totals: { CZK: 1839570.23 }, overdue_totals: { CZK: 1839570.23 },
    })).toEqual({ count: 0, totals: { CZK: 0 } });
    expect(dashboardBeforeDue(emptyDashboardData)).toEqual({ count: 0, totals: {} });
  });

  it("uses disjoint invoice states without counting ambiguous payments as invoices", () => {
    const parts = dashboardStatusParts(
      {
        ...emptyDashboardData,
        active_count: 25,
        overdue_count: 7,
        payments_needing_review: 4,
      },
      99,
    )!;
    expect(parts.map((part) => part.count)).toEqual([99, 18, 7]);
    expect(parts.reduce((sum, part) => sum + part.count, 0)).toBe(124);
  });

  it("does not turn an unavailable or inconsistent count into zero", () => {
    expect(dashboardStatusParts(emptyDashboardData, undefined)).toBeNull();
    expect(dashboardStatusParts(emptyDashboardData, -1)).toBeNull();
    expect(dashboardStatusParts(emptyDashboardData, 1.5)).toBeNull();
    expect(
      dashboardStatusParts({ ...emptyDashboardData, overdue_count: 1 }, 2),
    ).toBeNull();
  });

  it("keeps the zero-tenant donut denominator at zero", () => {
    expect(
      dashboardStatusParts(emptyDashboardData, 0)?.every(
        (part) => part.count === 0,
      ),
    ).toBe(true);
  });

  it.each([
    ["2026-01-31", 12, "2025-02-01"],
    ["2026-10-17", 12, "2025-11-01"],
    ["2026-01-01", 3, "2025-11-01"],
    ["2024-02-29", 6, "2023-09-01"],
  ] as const)(
    "uses calendar month boundaries for %s / %s months",
    (today, months, from) => {
      expect(dashboardReportRange(today, months)).toEqual({ from, to: today });
    },
  );
});

describe("monthly invoice balance composition", () => {
  const month = (key: string, issued: number, paid: number) => ({
    key,
    issued,
    paid,
    count: 1,
  });
  it("counts partial settlements once and excludes cancelled balances from the stack", () => {
    const result = dashboardMonthlyStatuses(
      { monthly: [month("2026-10", 150000, 55000)] },
      {
        paid: { monthly: [month("2026-10", 40000, 40000)] },
        pending: { monthly: [month("2026-10", 50000, 10000)] },
        overdue: { monthly: [month("2026-10", 35000, 5000)] },
      },
    );
    // Original totals retain a cancelled invoice (25,000 / 0); the stack does not.
    expect(result).toEqual([
      {
        key: "2026-10",
        issued: 150000,
        reportPaid: 55000,
        paid: 55000,
        pending: 40000,
        overdue: 30000,
        total: 125000,
      },
    ]);
  });
  it("joins by issue month rather than array position and retains months without live balances", () => {
    const result = dashboardMonthlyStatuses(
      { monthly: [month("2026-02", 200, 0), month("2026-01", 90, 10)] },
      {
        paid: { monthly: [] },
        pending: { monthly: [month("2026-01", 60, 10)] },
        overdue: { monthly: [month("2026-03", 30, 5)] },
      },
    );
    expect(
      result.map(({ key, paid, pending, overdue, total }) => ({
        key,
        paid,
        pending,
        overdue,
        total,
      })),
    ).toEqual([
      { key: "2026-01", paid: 10, pending: 50, overdue: 0, total: 60 },
      { key: "2026-02", paid: 0, pending: 0, overdue: 0, total: 0 },
      { key: "2026-03", paid: 5, pending: 0, overdue: 25, total: 30 },
    ]);
  });
  it("does not substitute invented zero values while a required report is unavailable", () => {
    expect(dashboardMonthlyStatuses({ monthly: [] }, undefined)).toEqual([]);
    expect(
      dashboardMonthlyStatuses(undefined, {
        paid: { monthly: [] },
        pending: { monthly: [] },
        overdue: { monthly: [] },
      }),
    ).toEqual([]);
  });
});

describe("dashboard amount search suggestion", () => {
  it.each([
    [
      "125 000,50 Kč",
      "/invoices?amount_min=125000.5&amount_max=125000.5&currency=CZK",
    ],
    ["10 EUR", "/invoices?amount_min=10&amount_max=10&currency=EUR"],
    ["0", "/invoices?amount_min=0&amount_max=0"],
  ])("uses existing filters for %s", (query, href) =>
    expect(dashboardAmountSearchHref(query)).toBe(href),
  );
  it.each([
    "",
    "ACME",
    "FV-2026-001",
    "1.2.3",
    "-100",
    "1e9",
    "99999999999999999999999999",
  ])("keeps %s as text search only", (query) =>
    expect(dashboardAmountSearchHref(query)).toBeNull(),
  );
});

describe("KPI count comparison", () => {
  it("uses disjoint 30-day windows across a leap day", () =>
    expect(dashboardComparisonRange("2024-03-01")).toEqual({
      current: { from: "2024-02-01", to: "2024-03-01" },
      previous: { from: "2024-01-02", to: "2024-01-31" },
    }));
  it.each([
    [28, 25, 12],
    [20, 25, -20],
    [0, 0, 0],
    [2, 0, null],
    [undefined, 1, undefined],
    [-1, 2, undefined],
  ])("handles %s versus %s without invented percentages", (a, b, result) =>
    expect(dashboardCountChange(a, b)).toBe(result),
  );
});

describe("complete-history chart grouping", () => {
  it("retains all monthly values while grouping a long history into readable bars", () => {
    const rows = Array.from({ length: 240 }, (_, index) => ({
      key: `${2007 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`,
      issued: 100,
      reportPaid: 50,
      paid: 50,
      pending: 30,
      overdue: 20,
      total: 100,
    }));
    const grouped = dashboardTrendGroups(rows);
    expect(grouped.length).toBeLessThanOrEqual(12);
    expect(grouped.reduce((sum, row) => sum + row.total, 0)).toBe(24000);
    expect(grouped.reduce((sum, row) => sum + row.paid, 0)).toBe(12000);
    expect(rows).toHaveLength(240);
    expect(rows[0].total).toBe(100);
  });
  it("keeps the reference monthly layout for up to twelve months", () => {
    const rows = [
      {
        key: "2026-10",
        issued: 100,
        reportPaid: 50,
        paid: 50,
        pending: 30,
        overdue: 20,
        total: 100,
      },
    ];
    expect(dashboardTrendGroups(rows)).toBe(rows);
  });
});
