import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const seen = new Set<string>();
const rpc = vi.fn(async (name: string, args: { event_id: string }) => {
  if (name === "record_stripe_event") seen.add(args.event_id);
  return { data: true, error: null };
});
vi.mock("@/lib/supabase-server", () => ({
  createServiceClient: () => ({
    rpc,
    from: () => ({ select: () => ({ eq: (_: string, id: string) => ({ maybeSingle: async () => ({ data: seen.has(id) ? { id } : null, error: null }) }) }) }),
  }),
}));

const syncSubscription = vi.fn(async () => ({}));
const activateFromSetupSession = vi.fn(async () => ({ status: "subscribed" }));
vi.mock("@/lib/stripe-billing", async (original) => ({
  ...(await original<typeof import("@/lib/stripe-billing")>()),
  syncSubscription,
  activateFromSetupSession,
}));

const SECRET = "whsec_test_secret";
const signer = new Stripe("sk_test_dummy");

function signed(event: Record<string, unknown>, secret = SECRET) {
  const payload = JSON.stringify(event);
  const header = signer.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://localhost/api/billing/stripe", { method: "POST", body: payload, headers: { "stripe-signature": header } });
}

const event = (id: string, type: string, object: Record<string, unknown>) => ({ id, object: "event", type, created: 1_790_000_000, data: { object } });

describe("Stripe webhook", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    seen.clear();
    rpc.mockClear();
    syncSubscription.mockClear();
    activateFromSetupSession.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a forged or unsigned request", async () => {
    const { POST } = await import("./route");
    const forged = await POST(signed(event("evt_x", "customer.subscription.updated", { id: "sub_1" }), "whsec_wrong"));
    expect(forged.status).toBe(400);
    const unsigned = await POST(new Request("http://localhost/api/billing/stripe", { method: "POST", body: "{}" }));
    expect(unsigned.status).toBe(400);
    expect(syncSubscription).not.toHaveBeenCalled();
  });

  it("re-reads the subscription for subscription and invoice events and records the event once", async () => {
    const { POST } = await import("./route");
    const first = await POST(signed(event("evt_1", "customer.subscription.updated", { id: "sub_1" })));
    expect(first.status).toBe(200);
    expect(syncSubscription).toHaveBeenCalledWith(expect.anything(), "sub_1");
    expect(rpc).toHaveBeenCalledWith("record_stripe_event", { event_id: "evt_1", event_type: "customer.subscription.updated" });

    const duplicate = await POST(signed(event("evt_1", "customer.subscription.updated", { id: "sub_1" })));
    expect(await duplicate.json()).toMatchObject({ duplicate: true });
    expect(syncSubscription).toHaveBeenCalledTimes(1);

    await POST(signed(event("evt_2", "invoice.payment_failed", { id: "in_1", parent: { subscription_details: { subscription: "sub_1" } } })));
    expect(syncSubscription).toHaveBeenCalledTimes(2);
  });

  it("activates after a completed card setup checkout", async () => {
    const { POST } = await import("./route");
    await POST(signed(event("evt_3", "checkout.session.completed", { id: "cs_test_1", mode: "setup", metadata: { organization_id: "org" } })));
    expect(activateFromSetupSession).toHaveBeenCalledWith(expect.anything(), "cs_test_1", null);
  });

  it("does not record a failed event, so Stripe retries it", async () => {
    syncSubscription.mockRejectedValueOnce(new Error("db down"));
    const { POST } = await import("./route");
    const response = await POST(signed(event("evt_4", "customer.subscription.updated", { id: "sub_1" })));
    expect(response.status).toBe(500);
    expect(seen.has("evt_4")).toBe(false);
  });
});
