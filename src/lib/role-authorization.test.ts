import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("reader authorization", () => {
  it("shows readers only the overview, reports and archive navigation", () => {
    const sidebar = source("src/components/app-sidebar.tsx");
    expect(sidebar).toContain('["/dashboard", "/reports", "/invoices/archive"]');
    expect(sidebar).toContain('role === "viewer" && !canAccessPage(role, pathname)');
  });

  it("hides invoice creation actions for readers", () => {
    const dashboard = source("src/app/dashboard/page.tsx");
    const invoices = source("src/app/invoices/page.tsx");
    expect(dashboard).toContain("const canManage = canManageInvoices(role)");
    expect(dashboard).toContain("{canManage ? <div className=\"top-actions dashboard-actions\">");
    expect(invoices).toContain("{canManage ? <Link href=\"/invoices/import\"");
    expect(invoices).toContain("{canManage ? <Link href=\"/invoices/new\"");
  });

  it("enforces reader restrictions on server endpoints", () => {
    for (const path of [
      "src/app/api/reminders/route.ts",
      "src/app/api/settings/company/route.ts",
      "src/app/api/settings/members/route.ts",
      "src/app/api/settings/reminders/route.ts",
    ]) {
      expect(source(path), path).toContain('identity.membership.role === "viewer"');
    }
    const invoicesRoute = source("src/app/api/invoices/route.ts");
    expect(invoicesRoute).toContain('["closed", "paid", "cancelled"]');
    expect(invoicesRoute).toContain('identity.membership.role === "viewer"');
  });
});
