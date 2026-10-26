import type { DashboardData } from "@/lib/dashboard-summary";
import { minorUnits } from "@/lib/money";

/** Open invoices include overdue ones. Subtract them once, per currency. */
export function dashboardBeforeDue(summary: DashboardData) {
  return {
    count: summary.active_count - summary.overdue_count,
    totals: Object.fromEntries(Object.entries(summary.open_totals).map(([currency, value]) => [
      currency,
      (minorUnits(value) - minorUnits(summary.overdue_totals[currency] ?? 0)) / 100,
    ])),
  };
}

/** Report periods are issue-date cohorts, not dates of individual bank receipts. */
export function dashboardReportRange(today: string, months: 3 | 6 | 12) {
  const [year, month] = today.split("-").map(Number);
  return {
    from: new Date(Date.UTC(year, month - months, 1))
      .toISOString()
      .slice(0, 10),
    to: today,
  };
}

/** Disjoint display categories. Ambiguous bank payments are a separate entity. */
export function dashboardStatusParts(
  summary: DashboardData,
  paidCount: number | undefined,
) {
  if (
    paidCount === undefined ||
    !Number.isSafeInteger(paidCount) ||
    paidCount < 0 ||
    summary.overdue_count < 0 ||
    summary.active_count < summary.overdue_count
  )
    return null;
  return [
    { key: "paid", label: "Zaplaceno", count: paidCount, color: "#2b7753" },
    {
      key: "pending",
      label: "Čeká na splatnost",
      count: summary.active_count - summary.overdue_count,
      color: "#edbe83",
    },
    {
      key: "overdue",
      label: "Po splatnosti",
      count: summary.overdue_count,
      color: "#d87570",
    },
  ];
}

export const dashboardMoney = (value: number, currency = "CZK") =>
  new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export const dashboardDate = (value: string) =>
  new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "Europe/Prague",
  }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));

export type DashboardStatusReports = Record<
  "paid" | "pending" | "overdue",
  Pick<import("@/lib/report-query").InvoiceReport, "monthly">
>;

/** Current balances of non-cancelled invoices, grouped by ISSUE month.
 * Each paid_amount appears once, including partial payments on still-open invoices.
 * Existing unfiltered report values stay available separately in the data table.
 */
export function dashboardMonthlyStatuses(
  report:
    Pick<import("@/lib/report-query").InvoiceReport, "monthly"> | undefined,
  statuses: DashboardStatusReports | undefined,
) {
  if (!report || !statuses) return [];
  const index = (rows: typeof report.monthly) =>
    new Map(rows.map((row) => [row.key, row]));
  const base = index(report.monthly),
    paid = index(statuses.paid.monthly),
    pending = index(statuses.pending.monthly),
    overdue = index(statuses.overdue.monthly);
  const keys = [
    ...new Set([
      ...base.keys(),
      ...paid.keys(),
      ...pending.keys(),
      ...overdue.keys(),
    ]),
  ].sort();
  return keys.map((key) => {
    const currentPaid =
      Number(paid.get(key)?.paid ?? 0) +
      Number(pending.get(key)?.paid ?? 0) +
      Number(overdue.get(key)?.paid ?? 0);
    const currentPending =
      Number(pending.get(key)?.issued ?? 0) -
      Number(pending.get(key)?.paid ?? 0);
    const currentOverdue =
      Number(overdue.get(key)?.issued ?? 0) -
      Number(overdue.get(key)?.paid ?? 0);
    return {
      key,
      issued: Number(base.get(key)?.issued ?? 0),
      reportPaid: Number(base.get(key)?.paid ?? 0),
      paid: currentPaid,
      pending: currentPending,
      overdue: currentOverdue,
      total: currentPaid + currentPending + currentOverdue,
    };
  });
}

/** Keep the complete history readable without dropping months from the chart.
 * The expandable values table always retains the original monthly detail.
 */
export function dashboardTrendGroups(
  rows: ReturnType<typeof dashboardMonthlyStatuses>,
) {
  if (rows.length <= 12) return rows;
  const firstYear = Number(rows[0].key.slice(0, 4));
  const lastYear = Number(rows.at(-1)!.key.slice(0, 4));
  const quarter = lastYear - firstYear < 3;
  const yearsPerGroup = Math.max(1, Math.ceil((lastYear - firstYear + 1) / 12));
  const groups = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const year = Number(row.key.slice(0, 4));
    const startYear =
      firstYear +
      Math.floor((year - firstYear) / yearsPerGroup) * yearsPerGroup;
    const key = quarter
      ? `${year} Q${Math.ceil(Number(row.key.slice(5, 7)) / 3)}`
      : yearsPerGroup === 1
        ? `${year}`
        : `${startYear}–${Math.min(startYear + yearsPerGroup - 1, lastYear)}`;
    const group = groups.get(key);
    if (!group) groups.set(key, { ...row, key });
    else {
      group.issued += row.issued;
      group.reportPaid += row.reportPaid;
      group.paid += row.paid;
      group.pending += row.pending;
      group.overdue += row.overdue;
      group.total += row.total;
    }
  }
  return [...groups.values()];
}

// Preserve the existing amount-search contract for other dashboard consumers.
export { searchAmountHref as dashboardAmountSearchHref } from "@/lib/workspace-search";

/** Two adjacent 30-day issue-date windows, independent of chart currency/period. */
export function dashboardComparisonRange(today: string) {
  const shift = (days: number) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  return {
    current: { from: shift(-29), to: today },
    previous: { from: shift(-59), to: shift(-30) },
  };
}
export function dashboardCountChange(
  current: number | undefined,
  previous: number | undefined,
) {
  if (
    current === undefined ||
    previous === undefined ||
    !Number.isSafeInteger(current) ||
    !Number.isSafeInteger(previous) ||
    current < 0 ||
    previous < 0
  )
    return undefined;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}
