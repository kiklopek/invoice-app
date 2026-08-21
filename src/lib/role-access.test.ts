import { describe, expect, it } from "vitest";
import {
  canAccessOperations,
  canAccessPage,
  canEditCompanySettings,
  canManageInvoices,
  canManageMembers,
  canViewCompanySettings,
  landingPageForRole,
} from "./role-access";

describe("role access", () => {
  it("limits readers to the complete read-only invoice area", () => {
    expect(canAccessPage("viewer", "/dashboard")).toBe(false);
    expect(canAccessPage("viewer", "/reports")).toBe(false);
    expect(canAccessPage("viewer", "/invoices/archive")).toBe(false);
    expect(canAccessPage("viewer", "/invoices/123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(canAccessPage("viewer", "/invoices")).toBe(true);
    expect(canAccessPage("viewer", "/invoices/new")).toBe(false);
    expect(canAccessPage("viewer", "/invoices/import")).toBe(false);
    expect(canAccessPage("viewer", "/reminders")).toBe(false);
    expect(canAccessPage("viewer", "/settings")).toBe(false);
  });

  it("allows accounting and admin roles to manage invoices", () => {
    expect(canManageInvoices("viewer")).toBe(false);
    expect(canManageInvoices("accounting")).toBe(true);
    expect(canManageInvoices("admin")).toBe(true);
  });

  it("keeps administration separate from accounting operations", () => {
    expect(canAccessOperations("accounting")).toBe(true);
    expect(canViewCompanySettings("accounting")).toBe(true);
    expect(canEditCompanySettings("accounting")).toBe(false);
    expect(canManageMembers("accounting")).toBe(false);
    expect(canEditCompanySettings("admin")).toBe(true);
    expect(canManageMembers("admin")).toBe(true);
  });

  it("uses the first permitted page as the role landing page", () => {
    expect(landingPageForRole("viewer")).toBe("/invoices");
    expect(landingPageForRole("accounting")).toBe("/dashboard");
    expect(landingPageForRole("admin")).toBe("/dashboard");
  });
});
