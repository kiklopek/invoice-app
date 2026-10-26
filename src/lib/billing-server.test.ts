import { expect, it, vi } from "vitest";
import { subscriptionBlock, subscriptionErrorResponse } from "./billing-server";
import type { RequestIdentity } from "./auth";
function identity({ used = 99, month = new Date().toISOString().slice(0, 7) + "-01T00:00:00.000Z", exempt = false, status = "active" } = {}) {
  const reads = vi.fn();
  const service = { from: () => ({ select: (columns: string) => ({ eq: (_key: string, org: string) => {
    reads(columns, org);
    return { maybeSingle: async () => ({ error: null, data: columns.includes("invoice_month_start") ? { invoice_month_start: month, invoice_month_used: used } : { status, plan: "start", trial_ends_at: null, current_period_end: null, billing_exempt: exempt, trial_invoices_used: 0, trial_invoice_limit: 50 } }) };
  } }) }) };
  return { reads, value: { service, membership: { organization_id: "own-org" } } as unknown as RequestIdentity };
}
it("rejects a batch that would cross the monthly quota before invoice insertion", async () => {
  const user = identity();
  const response = await subscriptionBlock(user.value, 2);
  expect(response?.status).toBe(402); expect(await response?.json()).toMatchObject({ code: "monthly_invoice_limit" });
  expect(user.reads.mock.calls.every(([, org]) => org === "own-org")).toBe(true);
});
it("allows exactly the remaining monthly capacity", async () => {
  expect(await subscriptionBlock(identity().value, 1)).toBeNull();
});
it("resets the displayed preflight month without carrying last month's usage", async () => {
  expect(await subscriptionBlock(identity({ used: 100, month: "2025-01-01T00:00:00.000Z" }).value, 2)).toBeNull();
});
it("keeps permanent access independent of paid plan limits", async () => {
  const user = identity({ used: 9000, exempt: true });
  expect(await subscriptionBlock(user.value, 1000)).toBeNull(); expect(user.reads).toHaveBeenCalledTimes(1);
});
it("maps the authoritative database quota failure to a payment/plan response", async () => {
  const response = subscriptionErrorResponse({ message: "monthly_invoice_limit" });
  expect(response?.status).toBe(402); expect(await response?.json()).toMatchObject({ code: "monthly_invoice_limit" });
});
