import { describe, expect, it, vi } from "vitest";
import { readBillingDetails, readSubscriptionUsage } from "./subscription-details-server";
import type { BillingDeps } from "./stripe-billing";

function fixture() {
  const stripe = {
    customers: { retrieve: vi.fn().mockResolvedValue({ id: "cus_org", invoice_settings: { default_payment_method: { id: "pm_safe", customer: "cus_org", type: "card", card: { brand: "visa", last4: "1111", exp_month: 1, exp_year: 2025, fingerprint: "secret-fingerprint", number: "must-not-leak" } } } }) },
    subscriptions: { retrieve: vi.fn().mockResolvedValue({ id: "sub_org", customer: "cus_org", status: "active", cancel_at_period_end: false, currency: "czk", items: { data: [{ quantity: 1, current_period_end: 1795000000, price: { unit_amount: 139000, currency: "czk", recurring: { interval: "month" } } }] } }) },
    invoices: { createPreview: vi.fn().mockResolvedValue({ amount_due: 99000, currency: "czk" }), list: vi.fn().mockResolvedValue({ data: [{ id: "in_org", customer: "cus_org", number: "2026-01", created: 1791000000, amount_paid: 99000, amount_due: 99000, currency: "czk", status: "paid", invoice_pdf: "https://pay.stripe.com/doc.pdf" }, { id: "in_other", customer: "cus_other", created: 1791000000 }] }) },
    paymentMethods: { retrieve: vi.fn() },
  };
  const deps = { stripe, service: {}, taxRateId: null, now: () => new Date("2026-10-23T00:00:00Z") } as unknown as BillingDeps;
  return { stripe, deps };
}
const row = { stripe_customer_id: "cus_org", stripe_subscription_id: "sub_org" };
describe("safe subscription presentation from provider", () => {
  it("uses actual custom prices and discounted invoice amounts without leaking payment secrets", async () => {
    const { stripe, deps } = fixture();
    const result = await readBillingDetails(deps, row);
    expect(result.pricing).toMatchObject({ amount: 139000, nextAmount: 99000, currency: "czk" });
    expect(result.card).toMatchObject({ last4: "1111", expired: true });
    expect(JSON.stringify(result)).not.toMatch(/fingerprint|must-not-leak|pm_safe|cus_org|sub_org/);
    expect(result.history).toHaveLength(1);
    expect(stripe.invoices.list).toHaveBeenCalledWith({ customer: "cus_org", limit: 10 });
  });
  it("refuses provider/customer mismatch", async () => {
    const { stripe, deps } = fixture(); stripe.subscriptions.retrieve.mockResolvedValue({ customer: "cus_other" });
    expect(await readBillingDetails(deps, row)).toMatchObject({ error: true, card: null, pricing: null, history: [] });
  });
  it("does not contact Stripe for exempt or missing billing customer", async () => {
    const { stripe, deps } = fixture();
    await readBillingDetails(deps, { ...row, billing_exempt: true }); await readBillingDetails(deps, {});
    expect(stripe.customers.retrieve).not.toHaveBeenCalled();
  });
  it("keeps known card and history when only upcoming invoice fails", async () => {
    const { stripe, deps } = fixture(); stripe.invoices.createPreview.mockRejectedValue(new Error("unavailable"));
    expect(await readBillingDetails(deps, row)).toMatchObject({ error: true, card: { last4: "1111" }, pricing: { amount: 139000, nextAmount: null } });
  });
  it("returns an explicit error for a provider outage", async () => {
    const { stripe, deps } = fixture(); stripe.customers.retrieve.mockRejectedValue(new Error("unavailable"));
    expect(await readBillingDetails(deps, row)).toMatchObject({ error: true, pricing: null });
  });
  it("has no preview of a next charge after scheduled cancellation", async () => {
    const { stripe, deps } = fixture();
    const subscription = await stripe.subscriptions.retrieve(); stripe.subscriptions.retrieve.mockResolvedValue({ ...subscription, cancel_at_period_end: true });
    await readBillingDetails(deps, row);
    expect(stripe.invoices.createPreview).not.toHaveBeenCalled();
  });
});

it("scopes every usage query to the firm and distinguishes trial counter from current-month usage", async () => {
  const eq = vi.fn();
  const service = { from: (table: string) => ({ select: () => ({ eq: (key: string, org: string) => {
    eq(table, key, org);
    const data = { invoice_month_start: "2026-09-01T00:00:00Z", invoice_month_used: 88 };
    return { count: 3, error: null, maybeSingle: async () => ({ data, error: null }) };
  } }) }) } as unknown as BillingDeps["service"];
  const now = new Date("2026-10-23T00:00:00Z");
  const active = await readSubscriptionUsage(service, "org", { state: "active", plan: "profi" }, now);
  expect(active.metrics[0]).toMatchObject({ used: 0, limit: 500, period: "month" });
  const trial = await readSubscriptionUsage(service, "org", { state: "trial", trial_invoices_used: 12, trial_invoice_limit: 50 }, now);
  expect(trial.metrics[0]).toMatchObject({ used: 12, limit: 50, period: "trial" });
  expect(eq.mock.calls.every(([, key, org]) => key === "organization_id" && org === "org")).toBe(true);
  expect(active.metrics.slice(1).every(metric => metric.limit === null && metric.used === 3)).toBe(true);
});
