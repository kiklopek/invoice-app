import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const css = source("src/app/minimal.css");
const disclosure = source("src/components/mobile-disclosure.tsx");
const remindersPage = source("src/app/(workspace)/reminders/reminders-client.tsx");

const czechUiSources = [
  "src/components/layout/app-shell.tsx",
  "src/components/invoice-form.tsx",
  "src/app/(workspace)/dashboard/page.tsx",
  "src/app/(workspace)/dashboard/dashboard-client.tsx",
  "src/app/(workspace)/invoices/page.tsx",
  "src/app/(workspace)/invoices/invoices-client.tsx",
  "src/app/(workspace)/invoices/[id]/page.tsx",
  "src/app/(workspace)/invoices/[id]/invoice-detail-client.tsx",
  "src/app/(workspace)/reminders/page.tsx",
  "src/app/(workspace)/reminders/reminders-client.tsx",
  "src/app/(workspace)/reports/page.tsx",
  "src/app/(workspace)/reports/reports-client.tsx",
  "src/app/(workspace)/settings/page.tsx",
  "src/app/(workspace)/settings/settings-client.tsx",
  "src/app/(auth)/login/page.tsx",
  "src/app/(auth)/mfa/page.tsx",
];

describe("mobile application layout", () => {
  it("keeps all six navigation destinations in an equal mobile grid", () => {
    expect(css).toContain("grid-template-columns: repeat(6, minmax(0, 1fr))");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(source("src/components/layout/app-shell.tsx").match(/href: "\//g)).toHaveLength(6);
    expect(source("src/components/layout/app-shell.tsx")).toContain('className="nav-logout"');
    expect(source("src/components/layout/mobile-navigation.css")).toContain('a[href="/reminders"] { grid-column: 8 / 10; }');
    expect(source("src/components/layout/mobile-navigation.css")).toContain('a[href="/settings"] { grid-column: 10 / 12; }');
    expect(source("src/components/layout/mobile-navigation.css")).toContain('.nav-logout { grid-column: 12 / 14; }');
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

  it("keeps the reminders overview calm with accessible progressive disclosure", () => {
    expect(remindersPage).toContain('className="reminder-operations reminder-quick-stats"');
    expect(remindersPage.match(/<details className=/g)).toHaveLength(2);
    expect(remindersPage).toContain("Provozní přehled a historie");
    expect(remindersPage).toContain("Texty e-mailů pro všechny kategorie");
    expect(remindersPage).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
    expect(css).toContain(".reminder-section-disclosure > summary:focus-visible");
    expect(css).toContain(".reminder-operations.reminder-quick-stats");
    expect(css).toContain("grid-template-columns: 1fr");
  });

  it("gives role and reminder selects a full-width mobile layout", () => {
    expect(css).toContain(".members-list article > select,");
    expect(css).toContain(".member-add select");
    expect(css).toContain(".human-rules .rule-main");
    expect(css).toContain(".rule-controls select");
    expect(css).toContain("min-height: 48px");
    expect(css).toContain("height: 48px !important");
    expect(css).toContain("-webkit-appearance: none");
    expect(css).toContain("padding: 0 var(--select-chevron-padding) 0 12px !important");
    expect(css).toContain("--select-chevron-size: clamp(11px, .9em, 14px)");
    expect(css).toContain("--select-chevron-offset: clamp(10px, 3%, 18px)");
  });

  it("turns operational wide tables into labeled mobile cards", () => {
    for (const path of [
      "src/app/(workspace)/invoices/import/page.tsx",
      "src/app/(workspace)/invoices/payments/page.tsx",
      "src/app/(workspace)/reports/reports-client.tsx",
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
