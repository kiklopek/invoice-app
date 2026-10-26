import { isIsoDate } from "./invoice-validation";

export type DashboardPeriod = 3 | 6 | 12 | "all";
export type DashboardDateRange = { from: string | null; to: string };

/** Every dashboard section uses the same invoice issue-date cohort. */
export function dashboardPeriodRange(
  today: string,
  period: DashboardPeriod,
): DashboardDateRange {
  if (period === "all") return { from: null, to: today };
  const [year, month] = today.split("-").map(Number);
  return {
    from: new Date(Date.UTC(year, month - period, 1))
      .toISOString()
      .slice(0, 10),
    to: today,
  };
}

/** An adjacent period with the same number of calendar days, with no overlap. */
export function dashboardPreviousRange(
  range: DashboardDateRange,
): DashboardDateRange | null {
  if (!range.from) return null;
  const start = Date.parse(`${range.from}T12:00:00Z`);
  const end = Date.parse(`${range.to}T12:00:00Z`);
  const day = 86_400_000;
  return {
    from: new Date(start - (end - start + day)).toISOString().slice(0, 10),
    to: new Date(start - day).toISOString().slice(0, 10),
  };
}

export function dashboardRangeParams(
  range: DashboardDateRange,
): URLSearchParams {
  return new URLSearchParams({
    ...(range.from ? { from: range.from } : {}),
    to: range.to,
  });
}

export function parseDashboardRange(
  params: URLSearchParams,
): DashboardDateRange | null {
  const from = params.get("from");
  const to = params.get("to");
  if (
    !to ||
    !isIsoDate(to) ||
    (from !== null && (!isIsoDate(from) || from > to))
  )
    return null;
  return { from, to };
}
