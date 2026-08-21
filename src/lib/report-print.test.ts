import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("multi-page report printing", () => {
  it("renders company, period and active filters in a print-only header", () => {
    const report = source("src/app/reports/page.tsx");
    expect(report).toContain('className="report-print-running-header"');
    expect(report).toContain('className="report-print-cover"');
    expect(report).toContain("profile?.companyName");
    expect(report).toContain("dateBasisNames[dateBasis]");
    expect(report).toContain("selectedStatus");
    expect(report).toContain("selectedCustomer");
  });

  it("prevents printing while the report is incomplete", () => {
    const report = source("src/app/reports/page.tsx");
    expect(report).toContain('disabled={loading || !report} onClick={() => window.print()}');
  });

  it("uses portrait A4 and preserves complete blocks across pages", () => {
    const styles = source("src/app/minimal.css");
    expect(styles).toContain("size: A4 portrait");
    expect(styles).toContain(".report-print-running-header");
    expect(styles).toContain("position: fixed");
    expect(styles).toContain(".analytics-card:not(.full)");
    expect(styles).toContain("break-inside: avoid");
  });

  it("allows long tables to span pages with repeated headings and whole rows", () => {
    const styles = source("src/app/minimal.css");
    expect(styles).toContain(".analytics-card.full");
    expect(styles).toContain("break-inside: auto !important");
    expect(styles).toContain("display: table-header-group !important");
    expect(styles).toContain("page-break-inside: avoid");
    expect(styles).toContain("table-layout: fixed");
    expect(styles).toContain("overflow: visible !important");
  });
});
