import { describe, expect, it } from "vitest";
import { canAccessPage, canManageInvoices } from "./role-access";

describe("role access", () => {
  it("limits readers to the overview, reports and archive", () => {
    expect(canAccessPage("viewer", "/dashboard")).toBe(true);
    expect(canAccessPage("viewer", "/reports")).toBe(true);
    expect(canAccessPage("viewer", "/invoices/archive")).toBe(true);
    expect(canAccessPage("viewer", "/invoices/123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(canAccessPage("viewer", "/invoices")).toBe(false);
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
});
