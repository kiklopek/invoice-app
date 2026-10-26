import { describe, expect, it } from "vitest";
import {
  dashboardPeriodRange,
  dashboardPreviousRange,
  dashboardRangeParams,
  parseDashboardRange,
} from "./dashboard-period";

describe("shared dashboard issue-date periods", () => {
  it.each([
    ["2026-01-31", 12, "2025-02-01"],
    ["2026-10-19", 3, "2026-08-01"],
    ["2024-02-29", 6, "2023-09-01"],
  ] as const)("uses calendar months for %s / %s", (today, months, from) => {
    expect(dashboardPeriodRange(today, months)).toEqual({ from, to: today });
  });
  it("has no artificial start date or fabricated comparison for all time", () => {
    const range = dashboardPeriodRange("2026-10-19", "all");
    expect(range).toEqual({ from: null, to: "2026-10-19" });
    expect(dashboardRangeParams(range).toString()).toBe("to=2026-10-19");
    expect(dashboardPreviousRange(range)).toBeNull();
  });
  it("compares equally long adjacent periods across a leap day", () => {
    expect(
      dashboardPreviousRange({ from: "2024-02-01", to: "2024-03-01" }),
    ).toEqual({ from: "2024-01-02", to: "2024-01-31" });
  });
  it.each([
    "from=2026-01-01",
    "to=invalid",
    "from=2026-02-30&to=2026-03-01",
    "from=2026-10-20&to=2026-10-19",
    "from=&to=2026-10-19",
  ])("rejects invalid ranges: %s", (params) => {
    expect(parseDashboardRange(new URLSearchParams(params))).toBeNull();
  });
  it("accepts valid inclusive dates", () => {
    expect(
      parseDashboardRange(new URLSearchParams("from=2026-10-19&to=2026-10-19")),
    ).toEqual({ from: "2026-10-19", to: "2026-10-19" });
  });
});
