import type { InvoiceReport } from "./report-query";

/** The RPC puts the synthetic remainder after ten real customers. Do not filter it as a customer. */
export function revenueRanking(report: InvoiceReport) {
  const real = report.customer_concentration.filter(
    (row, index) => !(index >= 10 && row.name === "Ostatní"),
  );
  const top = [...real]
    .sort((a, b) => Number(b.revenue) - Number(a.revenue))
    .slice(0, 5);
  const total = report.customer_concentration.reduce(
    (sum, row) => sum + Number(row.revenue),
    0,
  );
  return {
    top,
    total,
    other: total - top.reduce((sum, row) => sum + Number(row.revenue), 0),
  };
}

export function vatMetrics(report: InvoiceReport) {
  const rows = [...report.vat_breakdown].sort(
    (a, b) => Math.abs(Number(b.gross)) - Math.abs(Number(a.gross)),
  );
  return {
    main: rows[0] ?? null,
    base: rows.reduce((sum, row) => sum + Number(row.base), 0),
    tax: rows.reduce((sum, row) => sum + Number(row.tax), 0),
    otherBase: rows.slice(1).reduce((sum, row) => sum + Number(row.base), 0),
  };
}

export function reportPresetRange(
  type: "month" | "quarter" | "year",
  today: string,
) {
  const [year, month] = today.split("-").map(Number);
  const startMonth =
    type === "month"
      ? month
      : type === "quarter"
        ? Math.floor((month - 1) / 3) * 3 + 1
        : 1;
  return {
    from: `${year}-${String(startMonth).padStart(2, "0")}-01`,
    to: today,
  };
}

/** Compatibility for presentation callers; calculations and exports stay exact. */
export { compactMoneyLabel as reportMetricMoney } from "./money-display";
