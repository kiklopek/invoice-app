import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(join(process.cwd(), "src", "app", "api", "invoices", "[id]", "reminders", "[reminderId]", "retry", "route.ts"), "utf8");

describe("manual reminder retry reliability", () => {
  it("disambiguates the policy relation during the final invoice recheck", () => {
    expect(route).toContain("INVOICE_REMINDER_POLICY_STATE_SELECT");
    expect(route).not.toContain('select("*, reminder_policies(');
  });

  it("keeps a retry failed instead of skipping it when the database recheck fails", () => {
    expect(route).toContain("if (currentInvoiceError)");
    expect(route).toContain('status: "failed"');
    expect(route).toContain('code: "REMINDER_INVOICE_RECHECK_FAILED"');
    expect(route.indexOf("if (currentInvoiceError)")).toBeLessThan(route.indexOf("if (!currentInvoice ||"));
  });
});
