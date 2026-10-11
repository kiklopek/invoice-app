import { describe, expect, it } from "vitest";
import { billingNotice, invoiceAllowance, organizationsAllowedToSend, subscriptionState, type SubscriptionRow } from "./billing";

const now = new Date("2026-10-09T10:00:00Z");
const row = (overrides: Partial<SubscriptionRow>): SubscriptionRow => ({
  status: "trialing",
  trial_ends_at: "2026-10-20T10:00:00Z",
  current_period_end: "2026-10-20T10:00:00Z",
  trial_invoices_used: 0,
  trial_invoice_limit: 50,
  ...overrides,
});

describe("stav předplatného", () => {
  it("keeps a billing-exempt company (R. Hlavica) permanently active whatever the status says", () => {
    expect(subscriptionState(row({ status: "active", trial_ends_at: null, current_period_end: null, billing_exempt: true }), now)).toBe("active");
    expect(subscriptionState(row({ status: "canceled", billing_exempt: true }), now)).toBe("active");
  });

  // Firma bez řádku předplatného dřív fungovala zdarma navždy. Řádek má
  // každá firma (onboarding, legacy migrace); bez něj se platí jako bez karty.
  it("does not give a company without a subscription row free use", () => {
    expect(subscriptionState(null, now)).toBe("needs_payment");
  });

  it("maps Stripe statuses", () => {
    expect(subscriptionState(row({ status: "incomplete" }), now)).toBe("needs_payment");
    expect(subscriptionState(row({ status: "incomplete_expired" }), now)).toBe("needs_payment");
    expect(subscriptionState(row({ status: "trialing" }), now)).toBe("trial");
    expect(subscriptionState(row({ status: "active" }), now)).toBe("active");
    expect(subscriptionState(row({ status: "past_due" }), now)).toBe("past_due");
    for (const status of ["canceled", "unpaid", "paused"]) expect(subscriptionState(row({ status }), now)).toBe("expired");
  });

  it("does not expire a Stripe subscription just because the period end passed (renewal webhook may lag)", () => {
    expect(subscriptionState(row({ status: "active", current_period_end: "2026-10-01T00:00:00Z" }), now)).toBe("active");
  });

  it("treats unknown statuses as expired rather than free", () => {
    expect(subscriptionState(row({ status: "něco" }), now)).toBe("expired");
  });
});

describe("faktury podle předplatného", () => {
  it("allows invoices while trial has room and says how many remain", () => {
    expect(invoiceAllowance(row({ trial_invoices_used: 12 }), now)).toEqual({ ok: true, remaining: 38 });
    expect(invoiceAllowance(row({ status: "active", billing_exempt: true }), now)).toEqual({ ok: true, remaining: null });
    expect(invoiceAllowance(row({ status: "active" }), now)).toEqual({ ok: true, remaining: null });
    expect(invoiceAllowance(row({ status: "past_due" }), now)).toEqual({ ok: true, remaining: null });
  });

  it("blocks the 51st trial invoice, missing card and ended subscription with a clear reason", () => {
    expect(invoiceAllowance(row({ trial_invoices_used: 50 }), now)).toMatchObject({ ok: false, code: "trial_invoice_limit" });
    expect(invoiceAllowance(row({ status: "incomplete" }), now)).toMatchObject({ ok: false, code: "subscription_payment_required" });
    expect(invoiceAllowance(row({ status: "canceled" }), now)).toMatchObject({ ok: false, code: "subscription_expired" });
  });
});

describe("pruh v aplikaci", () => {
  it("warns 3 days before the trial ends", () => {
    expect(billingNotice(row({ trial_ends_at: "2026-10-11T09:00:00Z" }), now)).toEqual({ kind: "trial_ending", daysLeft: 2, used: 0, limit: 50 });
    expect(billingNotice(row({}), now)).toBeNull();
  });

  it("warns from 45 of 50 trial invoices and when the limit is reached", () => {
    expect(billingNotice(row({ trial_invoices_used: 45 }), now)).toEqual({ kind: "trial_invoices", daysLeft: 11, used: 45, limit: 50 });
    expect(billingNotice(row({ trial_invoices_used: 50 }), now)).toEqual({ kind: "trial_limit", daysLeft: 11, used: 50, limit: 50 });
  });

  it("shows failed payment, ended subscription and missing card", () => {
    expect(billingNotice(row({ status: "past_due" }), now)?.kind).toBe("payment_failed");
    expect(billingNotice(row({ status: "canceled" }), now)?.kind).toBe("expired");
    expect(billingNotice(row({ status: "incomplete" }), now)?.kind).toBe("needs_payment");
    expect(billingNotice(row({ status: "active", billing_exempt: true }), now)).toBeNull();
  });
});

describe("automat upomínek", () => {
  it("pauses sending for ended subscriptions and companies without a card", () => {
    const rows = [
      { ...row({ status: "canceled" }), organization_id: "a" },
      { ...row({ status: "incomplete" }), organization_id: "b" },
      { ...row({ status: "past_due" }), organization_id: "c" },
      { ...row({ status: "trialing" }), organization_id: "d" },
      { ...row({ status: "active", billing_exempt: true }), organization_id: "legacy" },
    ];
    expect(organizationsAllowedToSend(["a", "b", "c", "d", "legacy", "no-row"], rows, now)).toEqual(["c", "d", "legacy"]);
  });
});
