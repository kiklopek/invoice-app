import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const css = source("src/app/minimal.css");
const disclosure = source("src/components/mobile-disclosure.tsx");

const czechUiSources = [
  "src/components/app-sidebar.tsx",
  "src/components/invoice-form.tsx",
  "src/app/dashboard/page.tsx",
  "src/app/invoices/page.tsx",
  "src/app/invoices/[id]/page.tsx",
  "src/app/reminders/page.tsx",
  "src/app/reports/page.tsx",
  "src/app/settings/page.tsx",
  "src/app/login/page.tsx",
  "src/app/mfa/page.tsx",
];

describe("mobile application layout", () => {
  it("keeps all six navigation destinations in an equal mobile grid", () => {
    expect(css).toContain("grid-template-columns: repeat(6, minmax(0, 1fr))");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(source("src/components/app-sidebar.tsx").match(/href: "\//g)).toHaveLength(6);
  });

  it("uses the agreed mobile breakpoints and touch-safe controls", () => {
    expect(css).toContain("@media (max-width: 780px)");
    expect(css).toContain("@media (max-width: 520px)");
    expect(css).toContain("@media (max-width: 360px)");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("font-size: 16px");
    expect(css).toContain("overflow-x: clip");
    const layout = source("src/app/layout.tsx");
    expect(layout).toContain('width: "device-width"');
    expect(layout).toContain('viewportFit: "cover"');
  });

  it("provides an accessible reusable mobile disclosure", () => {
    expect(disclosure).toContain('aria-expanded={open}');
    expect(disclosure).toContain('aria-controls={contentId}');
    expect(disclosure).toContain('type="button"');
    expect(css).toContain(".mobile-disclosure.is-open .mobile-disclosure-content");
    expect(css).toContain(".access-history-disclosure { margin-top: 16px; }");
  });

  it("gives role and reminder selects a full-width mobile layout", () => {
    expect(css).toContain(".members-list article > select,");
    expect(css).toContain(".member-add select");
    expect(css).toContain(".human-rules .rule-main");
    expect(css).toContain(".rule-controls select");
    expect(css).toContain("min-height: 48px");
    expect(css).toContain("height: 48px !important");
    expect(css).toContain("-webkit-appearance: none");
    expect(css).toContain("padding: 0 42px 0 12px !important");
  });

  it("turns operational wide tables into labeled mobile cards", () => {
    for (const path of [
      "src/app/invoices/import/page.tsx",
      "src/app/invoices/payments/page.tsx",
      "src/app/reports/page.tsx",
    ]) {
      expect(source(path)).toContain("data-label=");
    }
    expect(css).toContain(".payment-preview-table table");
    expect(css).toContain(".debtor-table table");
    expect(css).toContain(".invoice-import-preview table");
  });

  it("keeps Czech UI sources free of common mojibake sequences", () => {
    for (const path of czechUiSources) {
      expect(source(path), path).not.toMatch(/PĹ|Ă|Â·|â€“|â€¦|Ĺ™/);
    }
  });
});
