import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { clearPriceCache } from "@/lib/stripe";
import { parseLookupKey, quote } from "@/lib/plans";
import {
  activateFromSetupSession,
  BillingError,
  changePlan,
  mirrorPayload,
  previewChange,
  previewTrialEnd,
  startCardSetup,
  startPaidSubscription,
  type BillingDeps,
} from "./stripe-billing";

const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-09T10:00:00Z");
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

type Row = Record<string, unknown>;

// Napodobená databáze: jen to, co stripe-billing volá.
function fakeService(row: Row, rpcResults: Record<string, unknown> = {}) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "sync_stripe_subscription") {
      Object.assign(row, (args.payload as Row));
      return { data: "updated", error: null };
    }
    return { data: rpcResults[name] ?? null, error: null };
  });
  const updates: Row[] = [];
  const service = {
    rpc,
    updates,
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === "subscriptions" ? row : null, error: null }),
          single: async () => ({ data: { name: "Firma s.r.o.", ico: "27082440", dic: "CZ27082440", email: "f@firma.cz" }, error: null }),
        }),
      }),
      update: (values: Row) => ({
        eq: async () => {
          updates.push(values);
          Object.assign(row, values);
          return { error: null };
        },
      }),
    }),
  };
  return service;
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    trial_end: null,
    cancel_at_period_end: false,
    metadata: { organization_id: ORG },
    schedule: null,
    pending_update: null,
    latest_invoice: null,
    items: { data: [{ id: "si_1", current_period_end: sec("2026-11-01T00:00:00Z"), price: { id: "price_profi_monthly", lookup_key: "splatno_profi_monthly" } }] },
    ...overrides,
  };
}

function fakeStripe(overrides: Record<string, unknown> = {}) {
  const prices: Record<string, string> = {
    splatno_start_monthly: "price_start_monthly",
    splatno_profi_monthly: "price_profi_monthly",
    splatno_business_monthly: "price_business_monthly",
    splatno_profi_yearly: "price_profi_yearly",
  };
  return {
    prices: { list: vi.fn(async ({ lookup_keys }: { lookup_keys: string[] }) => {
      const choice = parseLookupKey(lookup_keys[0])!;
      return { data: [{ id: prices[lookup_keys[0]], currency: "czk", unit_amount: quote(choice.plan, choice.period).netHalere, recurring: { interval: choice.period === "yearly" ? "year" : "month", interval_count: 1 } }] };
    }) },
    customers: {
      create: vi.fn(async () => ({ id: "cus_1" })),
      update: vi.fn(async () => ({})),
      retrieve: vi.fn(async () => ({ deleted: false, invoice_settings: { default_payment_method: "pm_1" } })),
    },
    checkout: {
      sessions: {
        create: vi.fn(async () => ({ url: "https://checkout.stripe.com/fixture" })),
        retrieve: vi.fn(async () => ({
          id: "cs_test_1",
          mode: "setup",
          status: "complete",
          customer: "cus_1",
          metadata: { organization_id: ORG, plan: "profi", period: "monthly", ip_hash: "a".repeat(64) },
          setup_intent: { payment_method: { id: "pm_1", card: { fingerprint: "fp_1" } } },
        })),
      },
    },
    subscriptions: {
      create: vi.fn(async () => subscription({ status: "trialing", trial_end: sec("2026-10-23T10:00:00Z") })),
      retrieve: vi.fn(async () => subscription()),
      update: vi.fn(async () => subscription()),
    },
    subscriptionSchedules: {
      create: vi.fn(async () => ({ id: "sub_sched_1", status: "active", phases: [{ start_date: sec("2026-10-01T00:00:00Z"), end_date: sec("2026-11-01T00:00:00Z") }] })),
      update: vi.fn(async () => ({})),
      release: vi.fn(async () => ({})),
    },
    invoices: { createPreview: vi.fn(async (input: { subscription_details?: { items?: { price: string }[]; proration_behavior?: string } }) => {
      const item = input.subscription_details?.items?.[0];
      const choice = item ? parseLookupKey(item.price.replace("price_", "splatno_")) : null;
      const total = choice ? quote(choice.plan, choice.period).grossHalere : 169400;
      return { amount_due: input.subscription_details?.proration_behavior === "always_invoice" ? 169400 : total, total };
    }) },
    ...overrides,
  };
}

function deps(stripe: ReturnType<typeof fakeStripe>, service: ReturnType<typeof fakeService>, taxRateId: string | null = "txr_1"): BillingDeps {
  return { stripe: stripe as never, service: service as never, taxRateId, now: () => NOW };
}

beforeEach(() => clearPriceCache());

describe("aktivace po uložení karty", () => {
  it("starts a 14-day trial for an eligible company, once per checkout session", async () => {
    const row: Row = { status: "incomplete", stripe_customer_id: "cus_1", stripe_subscription_id: null, trial_started_at: null, plan: "profi", period: "monthly" };
    const service = fakeService(row, { claim_trial: "eligible" });
    const stripe = fakeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: "trialing", trial_end: sec("2026-10-23T10:00:00Z") }) as never);
    const result = await activateFromSetupSession(deps(stripe, service), "cs_test_1", ORG);

    expect(result).toEqual({ status: "subscribed", subscriptionStatus: "trialing" });
    expect(service.rpc).toHaveBeenCalledWith("claim_trial", { target_org: ORG, target_fingerprint: "fp_1", target_ip_hash: "a".repeat(64) });
    expect(stripe.customers.update).toHaveBeenCalledWith("cus_1", { invoice_settings: { default_payment_method: "pm_1" } });
    expect(stripe.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1", trial_period_days: 14, default_payment_method: "pm_1", items: [{ price: "price_profi_monthly" }], default_tax_rates: ["txr_1"] }),
      { idempotencyKey: `splatno-trial-${ORG}` },
    );
    expect(row.status).toBe("trialing");
  });

  it("does not charge anything when the card or IČO already had a trial; it asks for confirmation with the amount", async () => {
    const row: Row = { status: "incomplete", stripe_customer_id: "cus_1", stripe_subscription_id: null, trial_started_at: null };
    const service = fakeService(row, { claim_trial: "card_used" });
    const stripe = fakeStripe();
    const result = await activateFromSetupSession(deps(stripe, service), "cs_test_1", ORG);

    expect(result).toEqual({ status: "trial_denied", reason: "card_used", choice: { plan: "profi", period: "monthly" }, dueNowHalere: 192390 });
    expect(stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(row.trial_denied_reason).toBe("card_used");
  });

  it("is idempotent: an existing subscription is only re-synced", async () => {
    const row: Row = { status: "trialing", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" };
    const stripe = fakeStripe();
    await activateFromSetupSession(deps(stripe, fakeService(row)), "cs_test_1", ORG);
    expect(stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1", { expand: ["schedule"] });
  });

  it("refuses a session of another company or another customer", async () => {
    const row: Row = { status: "incomplete", stripe_customer_id: "cus_OTHER" };
    await expect(activateFromSetupSession(deps(fakeStripe(), fakeService(row)), "cs_test_1", "22222222-2222-4222-8222-222222222222"))
      .rejects.toMatchObject({ code: "session_mismatch" });
    await expect(activateFromSetupSession(deps(fakeStripe(), fakeService(row)), "cs_test_1", ORG))
      .rejects.toMatchObject({ code: "customer_mismatch" });
  });

  it("waits while the checkout is not complete", async () => {
    const stripe = fakeStripe();
    stripe.checkout.sessions.retrieve.mockResolvedValueOnce({ id: "cs_test_1", mode: "setup", status: "open", customer: "cus_1", metadata: { organization_id: ORG } } as never);
    expect(await activateFromSetupSession(deps(stripe, fakeService({ status: "incomplete" })), "cs_test_1", ORG)).toEqual({ status: "pending" });
  });
});

describe("placené předplatné bez zkušební doby", () => {
  it("returns the Stripe invoice page when the bank requires 3-D Secure", async () => {
    const row: Row = { status: "incomplete", stripe_customer_id: "cus_1", stripe_subscription_id: null, plan: "start", period: "monthly" };
    const stripe = fakeStripe();
    stripe.subscriptions.create.mockResolvedValueOnce(subscription({ status: "incomplete", latest_invoice: { hosted_invoice_url: "https://invoice.stripe.com/i/1" } }) as never);
    const result = await startPaidSubscription(deps(stripe, fakeService(row)), ORG);
    expect(result).toEqual({ status: "requires_action", url: "https://invoice.stripe.com/i/1" });
    expect(stripe.subscriptions.create).toHaveBeenCalledWith(expect.objectContaining({ payment_behavior: "allow_incomplete", items: [{ price: "price_start_monthly" }] }), expect.anything());
  });
});

// Trvale zdarma (R. Hlavica): Stripe se k firmě nesmí dostat. Dřív stačilo
// projít Checkoutem, uložil se stripe_customer_id a zrcadlení pak trvalé
// předplatné tiše přepsalo na placené.
describe("firma s trvalým přístupem bez platby", () => {
  const exempt: Row = { status: "active", billing_exempt: true, stripe_customer_id: null, stripe_subscription_id: null, plan: null, period: null };

  it("refuses card setup before touching Stripe or the subscription row", async () => {
    const stripe = fakeStripe();
    const service = fakeService({ ...exempt });
    await expect(startCardSetup(deps(stripe, service), {
      organizationId: ORG, choice: { plan: "start", period: "monthly" }, ipHash: null,
      returnBase: "https://splatno.cz", returnPath: "/predplatne",
    })).rejects.toMatchObject({ code: "billing_exempt", status: 409 });
    expect(service.updates).toEqual([]);
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it("refuses a paid subscription", async () => {
    const stripe = fakeStripe();
    await expect(startPaidSubscription(deps(stripe, fakeService({ ...exempt, stripe_customer_id: "cus_1" })), ORG))
      .rejects.toMatchObject({ code: "billing_exempt" });
    expect(stripe.subscriptions.create).not.toHaveBeenCalled();
  });
});

describe("změna tarifu", () => {
  const live: Row = { status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" };

  it("previews an upgrade from Stripe and charges nothing during the trial", async () => {
    const stripe = fakeStripe();
    const preview = await previewChange(deps(stripe, fakeService({ ...live })), ORG, { plan: "business", period: "monthly" });
    expect(preview).toMatchObject({ kind: "upgrade", dueNowHalere: 169400, nextChargeHalere: 361790 });
    expect(stripe.invoices.createPreview).toHaveBeenCalledWith(expect.objectContaining({
      subscription: "sub_1",
      subscription_details: expect.objectContaining({ proration_behavior: "always_invoice", items: [{ id: "si_1", price: "price_business_monthly" }] }),
    }));

    stripe.subscriptions.retrieve.mockResolvedValueOnce(subscription({ status: "trialing" }) as never);
    const trial = await previewChange(deps(stripe, fakeService({ ...live })), ORG, { plan: "business", period: "monthly" });
    expect(trial).toMatchObject({ kind: "trial", dueNowHalere: 0 });
  });

  it("previews a downgrade from the end of the period without asking Stripe for money", async () => {
    const stripe = fakeStripe();
    const preview = await previewChange(deps(stripe, fakeService({ ...live })), ORG, { plan: "start", period: "monthly" });
    expect(preview).toMatchObject({ kind: "downgrade", dueNowHalere: 0, effectiveAt: "2026-11-01T00:00:00.000Z" });
    expect(stripe.invoices.createPreview).toHaveBeenCalledWith(expect.objectContaining({ subscription_details: expect.objectContaining({ proration_behavior: "none" }) }));
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
  it("uses a provider estimate with discounts instead of replacing the next charge with a catalog price", async () => {
    const stripe = fakeStripe();
    stripe.invoices.createPreview.mockResolvedValue({ amount_due: 50000, total: 50000 });
    const preview = await previewChange(deps(stripe, fakeService({ ...live })), ORG, { plan: "start", period: "monthly" });
    expect(preview).toMatchObject({ dueNowHalere: 0, nextChargeHalere: 50000 });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("upgrades now with proration and leaves the plan unchanged when payment fails", async () => {
    const stripe = fakeStripe();
    stripe.subscriptions.update.mockResolvedValueOnce(subscription({ pending_update: { expires_at: 1 }, latest_invoice: { hosted_invoice_url: "https://invoice.stripe.com/i/2" } }) as never);
    const result = await changePlan(deps(stripe, fakeService({ ...live })), ORG, { plan: "business", period: "monthly" }, 1_790_000_000);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", expect.objectContaining({
      proration_behavior: "always_invoice", proration_date: 1_790_000_000, payment_behavior: "pending_if_incomplete",
    }), undefined);
    expect(result).toEqual({ status: "payment_required", kind: "upgrade", url: "https://invoice.stripe.com/i/2" });
  });

  it("schedules a downgrade for the next period and keeps the current price until then", async () => {
    const stripe = fakeStripe();
    const result = await changePlan(deps(stripe, fakeService({ ...live })), ORG, { plan: "start", period: "monthly" }, 0);
    expect(stripe.subscriptionSchedules.create).toHaveBeenCalledWith({ from_subscription: "sub_1" }, undefined);
    const [, params] = stripe.subscriptionSchedules.update.mock.calls[0] as unknown as [string, { phases: { items: { price: string }[]; end_date?: number }[]; metadata: Row; end_behavior: string }];
    expect(params.metadata).toEqual({ plan: "start", period: "monthly" });
    expect(params.end_behavior).toBe("release");
    expect(params.phases[0]).toMatchObject({ items: [{ price: "price_profi_monthly", quantity: 1 }], end_date: sec("2026-11-01T00:00:00Z") });
    expect(params.phases[1].items).toEqual([{ price: "price_start_monthly", quantity: 1 }]);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "scheduled", kind: "downgrade" });
  });

  it("refuses changes while the last payment failed", async () => {
    const stripe = fakeStripe();
    stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: "past_due" }) as never);
    await expect(changePlan(deps(stripe, fakeService({ ...live })), ORG, { plan: "business", period: "monthly" }, 0))
      .rejects.toBeInstanceOf(BillingError);
  });
});

describe("zrcadlení stavu", () => {
  it("reports a scheduled downgrade only while it is still ahead", () => {
    const scheduled = subscription({
      schedule: { status: "active", metadata: { plan: "start", period: "monthly" }, phases: [{ start_date: sec("2026-10-01T00:00:00Z") }, { start_date: sec("2026-11-01T00:00:00Z") }] },
    });
    expect(mirrorPayload(scheduled as never, NOW)).toMatchObject({
      plan: "profi", period: "monthly", scheduled_plan: "start", scheduled_period: "monthly", scheduled_at: "2026-11-01T00:00:00.000Z",
      current_period_end: "2026-11-01T00:00:00.000Z", customer_id: "cus_1", subscription_id: "sub_1",
    });
    expect(mirrorPayload(scheduled as never, new Date("2026-11-02T00:00:00Z"))).toMatchObject({ scheduled_plan: null, scheduled_at: null });
  });
});

describe("subscription management guards", () => {
  const row = { status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", plan: "profi", period: "monthly" };
  it("rejects a provider price that disagrees with the configured currency or amount before any mutation", async () => {
    const stripe = fakeStripe();
    stripe.prices.list.mockResolvedValue({ data: [{ id: "price_wrong", currency: "usd", unit_amount: 1, recurring: { interval: "month", interval_count: 1 } }] });
    await expect(changePlan(deps(stripe, fakeService({ ...row })), ORG, { plan: "business", period: "monthly" }, 1790000000)).rejects.toThrow("stripe_price_configuration_mismatch");
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
  it("rejects a stored subscription that belongs to another customer", async () => {
    const stripe = fakeStripe(); stripe.subscriptions.retrieve.mockResolvedValue(subscription({ customer: "cus_other" }) as never);
    await expect(previewChange(deps(stripe, fakeService({ ...row })), ORG, { plan: "start", period: "monthly" })).rejects.toMatchObject({ code: "subscription_mismatch" });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
  it("uses the provider for the actual trial-ending charge", async () => {
    const stripe = fakeStripe(); stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: "trialing" }) as never);
    expect(await previewTrialEnd(deps(stripe, fakeService({ ...row, status: "trialing" })), ORG)).toMatchObject({ dueNowHalere: 169400 });
    expect(stripe.invoices.createPreview).toHaveBeenCalledWith({ subscription: "sub_1", subscription_details: { trial_end: "now", proration_behavior: "none" } });
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
  it("passes the caller's idempotency key through to the provider mutation", async () => {
    const stripe = fakeStripe();
    await changePlan({ ...deps(stripe, fakeService({ ...row })), idempotencyKey: "operation-123" }, ORG, { plan: "business", period: "monthly" }, 1790000000);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", expect.anything(), { idempotencyKey: "operation-123-upgrade" });
  });
  it("recovers a missing subscription row through the existing card setup flow without replacing another row", async () => {
    const stripe = fakeStripe();
    const backing = fakeService({ status: "incomplete", plan: "start", period: "monthly" });
    let missing = true;
    const upsert = vi.fn(async () => { missing = false; return { error: null }; });
    const service = { ...backing, from: (table: string) => {
      const query = backing.from(table);
      if (table !== "subscriptions") return query;
      return { ...query, upsert, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: missing ? null : { status: "incomplete", plan: "start", period: "monthly", stripe_customer_id: null, stripe_subscription_id: null }, error: null }) }) }) };
    } };
    const url = await startCardSetup({ ...deps(stripe, backing), service: service as never }, { organizationId: ORG, choice: { plan: "start", period: "monthly" }, ipHash: null, returnBase: "https://app.example", returnPath: "/predplatne" });
    expect(url).toContain("checkout.stripe.com");
    expect(upsert).toHaveBeenCalledWith({ organization_id: ORG, status: "incomplete", plan: "start", period: "monthly" }, { onConflict: "organization_id", ignoreDuplicates: true });
    expect(stripe.subscriptions.create).not.toHaveBeenCalled();
  });
});
