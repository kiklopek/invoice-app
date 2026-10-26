import { describe, expect, it } from "vitest";
import { activeReportFilterCount, selectedReportPeriod, type ReportFilters } from "./report-mobile-controls";
const defaults: ReportFilters = { from: "2026-01-01", to: "2026-10-25", dateBasis: "issue_date", currency: "CZK", status: "all", customer: "all" };
describe("mobile report control presentation", () => {
  it("does not count the period or default invoice filters", () => {
    expect(activeReportFilterCount(defaults, false)).toBe(0);
    expect(activeReportFilterCount({ ...defaults, from: "2026-10-01" }, false)).toBe(0);
  });
  it("counts each non-default advanced filter exactly once", () => {
    expect(activeReportFilterCount({ ...defaults, currency: "EUR", status: "overdue", customer: "Firma", dateBasis: "due_date" }, false)).toBe(4);
    expect(activeReportFilterCount({ ...defaults, customer: "Firma" }, false)).toBe(1);
  });
  it("never presents retained invoice filters as bank filters", () => {
    expect(activeReportFilterCount({ ...defaults, currency: "EUR", status: "overdue", customer: "Firma", dateBasis: "paid_at" }, true)).toBe(0);
  });
  it("recognizes periods using the existing date ranges", () => {
    expect(selectedReportPeriod(defaults, "2026-10-25")?.[0]).toBe("year");
    expect(selectedReportPeriod({ from: "2026-02-01", to: "2026-03-31" }, "2026-10-25")).toBeUndefined();
  });
  it("retains explicit quarter selection when month and quarter share their dates", () => {
    const value = { from: "2026-10-01", to: "2026-10-25" };
    expect(selectedReportPeriod(value, "2026-10-25", "quarter")?.[0]).toBe("quarter");
    expect(selectedReportPeriod(value, "2026-10-25", "month")?.[0]).toBe("month");
    expect(selectedReportPeriod(value, "2026-10-25", "year")?.[0]).toBe("month");
  });
});
