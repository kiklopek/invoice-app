import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("role authorization", () => {
  it("shows readers dashboard, invoices and reports and redirects forbidden pages", () => {
    const sidebar = source("src/components/app-sidebar.tsx");
    expect(sidebar).toContain('["/dashboard", "/invoices", "/reports"].includes(item.href)');
    expect(sidebar).toContain("router.replace(landingPageForRole(role))");
    expect(sidebar).toContain('role === "viewer" ? viewerItems');
  });

  it("hides invoice creation actions for readers", () => {
    const dashboard = source("src/app/dashboard/page.tsx");
    const invoices = source("src/app/invoices/page.tsx");
    expect(dashboard).toContain("const canManage = canManageInvoices(role)");
    expect(dashboard).toContain("{canManage ? <div className=\"top-actions dashboard-actions\">");
    expect(invoices).toContain("{canManage ? <Link href=\"/invoices/import\"");
    expect(invoices).toContain("{canManage ? <Link href=\"/invoices/new\"");
  });

  it("allows read-only insights but enforces reader restrictions on operational endpoints", () => {
    for (const path of [
      "src/app/api/dashboard/route.ts",
      "src/app/api/reports/route.ts",
    ]) {
      expect(source(path), path).toContain("canViewFinancialInsights(identity.membership.role)");
      expect(source(path), path).not.toContain("canAccessOperations(identity.membership.role)");
    }
    for (const path of [
      "src/app/api/payments/route.ts",
      "src/app/api/reminders/route.ts",
      "src/app/api/settings/reminders/route.ts",
    ]) {
      expect(source(path), path).toContain("canAccessOperations(identity.membership.role)");
    }
    const invoicesRoute = source("src/app/api/invoices/route.ts");
    expect(invoicesRoute).not.toContain("Čtenář má přístup pouze k archivu faktur");
    expect(invoicesRoute).toContain("if (wantsCsv)");
  });

  it("shows company data read-only to accounting and hides access administration", () => {
    const settings = source("src/app/settings/page.tsx");
    const companyRoute = source("src/app/api/settings/company/route.ts");
    const membersRoute = source("src/app/api/settings/members/route.ts");
    expect(settings).toContain('currentRole === "admin" ? ["/api/settings/company", "/api/settings/members"] : ["/api/settings/company"]');
    expect(settings).toContain("<fieldset disabled={!canAdminister}>");
    expect(settings).toContain("{canAdminister && <><section");
    expect(settings).toContain("Přehled, reporty a faktury pouze pro čtení");
    expect(companyRoute).toContain("canViewCompanySettings(identity.membership.role)");
    expect(companyRoute).toContain("canEditCompanySettings(identity.membership.role)");
    expect(membersRoute).toContain("canManageMembers(identity.membership.role)");
  });

  it("shows the signed-in user's name, company and initials", () => {
    const accessRoute = source("src/app/api/auth/access/route.ts");
    const sidebar = source("src/components/app-sidebar.tsx");
    expect(accessRoute).toContain("displayName(identity.user.user_metadata.full_name, email)");
    expect(accessRoute).toContain("email,");
    expect(accessRoute).toContain('companyName: organization?.name?.trim() || "Firma"');
    expect(sidebar).toContain("profileInitials(profile.name, profile.email)");
    expect(sidebar).toContain("profile?.name");
    expect(sidebar).toContain("profile?.companyName");
    expect(sidebar).not.toContain("<small>{profile?.email");
  });
});
