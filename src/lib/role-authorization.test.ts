import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canAccessPage } from "./role-access";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("role authorization", () => {
  it("shows readers dashboard, invoices and reports and redirects forbidden pages", () => {
    const sidebar = source("src/components/layout/app-shell.tsx");
    const roleAccess = source("src/lib/role-access.ts");
    // Nav visibility and page-load gating used to be two independently
    // maintained allowlists that happened to agree by coincidence -- this
    // pins them to the SAME source so a future nav item can't silently drift
    // out of sync with what a reader is actually allowed to open.
    expect(roleAccess).toContain('export const VIEWER_ALLOWED_PATHS = ["/dashboard", "/invoices", "/reports", "/customers"]');
    expect(sidebar).toContain("canAccessPage(role, item.href)");
    expect(sidebar).toContain("router.replace(landingPageForRole(role))");
  });

  it("never renders a nav item or sub-item a reader would be bounced out of", () => {
    // canAccessPage is the ONLY gate now (see the previous test) -- this walks
    // every href the nav can produce and checks it against that same
    // function, so a future nav entry a viewer cannot open fails here instead
    // of shipping as a dead-end link discovered by a confused user.
    const sidebar = source("src/components/layout/app-shell.tsx");
    const hrefs = [...sidebar.matchAll(/href:\s*"([^"]+)"/g)].map(match => match[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    const readerAllowed = hrefs.filter(href => canAccessPage("viewer", href));
    expect(readerAllowed).toEqual(["/dashboard", "/invoices", "/customers", "/reports"]);
  });

  it("hides invoice creation actions for readers", () => {
    const dashboard = source("src/app/(workspace)/dashboard/dashboard-client.tsx");
    const invoices = source("src/app/(workspace)/invoices/invoices-client.tsx");
    expect(dashboard).toContain("const canManage = canManageInvoices(role)");
    expect(dashboard).toContain("{canManage ? <div className=\"top-actions dashboard-actions\">");
    expect(invoices).toContain("{canManage ? <Link href=\"/invoices/import\"");
    expect(invoices).toContain("{canManage ? <Link href=\"/invoices/new\"");
  });

  it("allows read-only insights but enforces reader restrictions on operational endpoints", () => {
    const dashboardRead = source("src/app/api/dashboard/route.ts") + source("src/lib/dashboard-page-data.ts");
    const reportsRead = source("src/app/api/reports/route.ts") + source("src/lib/report-page-data.ts");
    for (const [name, implementation] of [["dashboard", dashboardRead], ["reports", reportsRead]]) {
      expect(implementation, name).toContain("canViewFinancialInsights(identity.membership.role)");
      expect(implementation, name).not.toContain("canAccessOperations(identity.membership.role)");
    }
    for (const path of [
      "src/lib/payments-page-data.ts",
      "src/app/api/reminders/route.ts",
      "src/app/api/settings/reminders/route.ts",
    ]) {
      expect(source(path), path).toContain("canAccessOperations(identity.membership.role)");
    }
    const invoicesRoute = source("src/app/api/invoices/route.ts");
    expect(invoicesRoute).not.toContain("Čtenář má přístup pouze k archivu faktur");
    expect(invoicesRoute).toContain("if (wantsExcel)");
  });

  it("shows company data read-only to accounting and hides access administration", () => {
    const settings = source("src/app/(workspace)/settings/settings-client.tsx");
    const settingsLoader = source("src/lib/settings-page-data.ts");
    const companyRoute = source("src/app/api/settings/company/route.ts");
    const membersRoute = source("src/app/api/settings/members/route.ts");
    expect(settingsLoader).toContain("canManageMembers(identity.membership.role)");
    expect(settings).toContain("<fieldset disabled={!canAdminister}>");
    expect(settings).toContain("{canAdminister && <><section");
    expect(settings).toContain("Přehled, reporty a faktury pouze pro čtení");
    expect(companyRoute).toContain("canViewCompanySettings(identity.membership.role)");
    expect(companyRoute).toContain("canEditCompanySettings(identity.membership.role)");
    expect(membersRoute).toContain("canManageMembers(identity.membership.role)");
  });

  it("shows the signed-in user's name, company and initials", () => {
    const accessRoute = source("src/app/api/auth/access/route.ts");
    const sidebar = source("src/components/layout/app-shell.tsx");
    expect(accessRoute).toContain("displayName(identity.user.user_metadata.full_name, email)");
    expect(accessRoute).toContain("email,");
    expect(accessRoute).toContain('companyName: organization?.name?.trim() || "Firma"');
    expect(sidebar).toContain("profileInitials(profile.name, profile.email)");
    expect(sidebar).toContain("profile?.name");
    expect(sidebar).toContain("profile?.companyName");
    expect(sidebar).not.toContain("<small>{profile?.email");
  });
});
