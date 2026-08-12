import { describe, expect, it } from "vitest";
import {
  INVOICE_REMINDER_POLICY_SELECT,
  INVOICE_REMINDER_POLICY_STATE_SELECT,
  REMINDER_POLICY_RELATION,
  reminderDatabaseError,
} from "./reminder-automation-query";

describe("reminder automation query contract", () => {
  it("always disambiguates the organization-scoped policy relationship", () => {
    expect(REMINDER_POLICY_RELATION).toBe("reminder_policies!invoices_policy_same_org_fkey");
    expect(INVOICE_REMINDER_POLICY_SELECT).toContain("reminder_policy:reminder_policies!invoices_policy_same_org_fkey");
    expect(INVOICE_REMINDER_POLICY_STATE_SELECT).toContain("reminder_policy:reminder_policies!invoices_policy_same_org_fkey");
    expect(INVOICE_REMINDER_POLICY_SELECT).not.toMatch(/reminder_policy:reminder_policies\(/);
  });

  it("keeps actionable database diagnostics within the audit column limit", () => {
    const detail = reminderDatabaseError("Načtení faktur", {
      code: "PGRST201",
      message: "Could not embed because more than one relationship was found",
      details: "x".repeat(1200),
      hint: "Use an explicit relationship",
    });
    expect(detail).toContain("PGRST201");
    expect(detail).toContain("Načtení faktur");
    expect(detail.length).toBeLessThanOrEqual(1000);
  });
});
