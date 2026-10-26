import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), load: vi.fn(), deps: vi.fn(), details: vi.fn(), usage: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.identity }));
vi.mock("@/lib/billing-server", () => ({ loadSubscription: mocks.load, billingDeps: mocks.deps }));
vi.mock("@/lib/subscription-details-server", () => ({ readBillingDetails: mocks.details, readSubscriptionUsage: mocks.usage }));
import { GET } from "./route";
const request = (query = "?details=1") => new Request(`https://example.test/api/billing${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({ membership: { organization_id: "own-org", role: "admin" }, service: "scoped-service" });
  mocks.load.mockResolvedValue({ row: { status: "active", stripe_customer_id: "cus_org", stripe_subscription_id: "sub_org", plan: "profi" }, state: "active", failed: false });
  mocks.deps.mockReturnValue({ stripe: "mock-provider" });
  mocks.details.mockResolvedValue({ pricing: { amount: 139000 }, card: { last4: "1111" } });
  mocks.usage.mockResolvedValue({ month: "2026-10-01", metrics: [] });
});
it("rejects anonymous reads", async () => {
  mocks.identity.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  expect(mocks.load).not.toHaveBeenCalled();
});
it("takes the firm from the session, never from query parameters", async () => {
  const response = await GET(request("?details=1&organization_id=another-org"));
  expect(response.status).toBe(200);
  expect(mocks.load).toHaveBeenCalledWith("scoped-service", "own-org");
  expect(mocks.usage).toHaveBeenCalledWith("scoped-service", "own-org", expect.anything());
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json(); expect(body.subscription.stripe_customer_id).toBeUndefined();
});
it("does not expose provider details to non-admins", async () => {
  mocks.identity.mockResolvedValue({ membership: { organization_id: "own-org", role: "accounting" }, service: "scoped-service" });
  const body = await (await GET(request())).json();
  expect(body.can_manage).toBe(false); expect(body.details).toBeNull();
  expect(mocks.details).not.toHaveBeenCalled();
});
it("does not report a failed database read as an active subscription", async () => {
  mocks.load.mockResolvedValue({ row: null, state: "active", failed: true });
  expect((await GET(request())).status).toBe(503); expect(mocks.details).not.toHaveBeenCalled();
});
it("keeps lightweight existing consumers free of provider calls", async () => {
  const body = await (await GET(request(""))).json();
  expect(body.details).toBeUndefined(); expect(mocks.details).not.toHaveBeenCalled(); expect(mocks.usage).not.toHaveBeenCalled();
});
