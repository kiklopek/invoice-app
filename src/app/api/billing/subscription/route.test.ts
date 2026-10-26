import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), change: vi.fn(), preview: vi.fn(), cancel: vi.fn(), portal: vi.fn(), trialPreview: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.identity }));
vi.mock("@/lib/stripe", () => ({ getStripe: () => "mock-stripe", stripeConfiguration: () => ({ taxRateId: null }) }));
vi.mock("@/lib/stripe-billing", async original => ({ ...(await original<typeof import("@/lib/stripe-billing")>()), changePlan: mocks.change, previewChange: mocks.preview, setCancelAtPeriodEnd: mocks.cancel, billingPortalUrl: mocks.portal, previewTrialEnd: mocks.trialPreview }));
import { POST } from "./route";
const identity = { user: { id: "admin-user" }, membership: { organization_id: "own-org", role: "admin" }, service: {} };
function request(body: object, origin = "https://app.example", key = "12345678-1234-1234-1234-123456789012") {
  return new Request("https://app.example/api/billing/subscription", { method: "POST", headers: { origin, "content-type": "application/json", "x-idempotency-key": key }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.identity.mockResolvedValue(identity); mocks.change.mockResolvedValue({ status: "changed" }); mocks.preview.mockResolvedValue({ kind: "upgrade" }); mocks.cancel.mockResolvedValue(undefined); mocks.portal.mockResolvedValue("https://billing.stripe.com/test"); mocks.trialPreview.mockResolvedValue({ dueNowHalere: 99000, currency: "czk" });
});
it("rejects anonymous, non-admin and cross-origin mutations", async () => {
  expect((await POST(request({ action: "portal" }, "https://evil.example"))).status).toBe(403);
  mocks.identity.mockResolvedValueOnce(null); expect((await POST(request({ action: "portal" }))).status).toBe(401);
  mocks.identity.mockResolvedValueOnce({ ...identity, membership: { ...identity.membership, role: "accounting" } });
  expect((await POST(request({ action: "portal" }))).status).toBe(403); expect(mocks.portal).not.toHaveBeenCalled();
});
it("requires confirmation and validates configured plans and periods", async () => {
  expect((await POST(request({ action: "change", plan: "profi", period: "monthly" }))).status).toBe(400);
  expect((await POST(request({ action: "change", plan: "enterprise", period: "monthly", confirm: true }))).status).toBe(400);
  expect((await POST(request({ action: "change", plan: "profi", period: "weekly", confirm: true }))).status).toBe(400);
  expect(mocks.change).not.toHaveBeenCalled();
});
it("ignores client-supplied tenant, provider IDs and price amounts", async () => {
  const response = await POST(request({ action: "change", plan: "profi", period: "yearly", confirm: true, organization_id: "other-org", stripe_customer_id: "cus_other", amount: 1, price: "price_fake" }));
  expect(response.status).toBe(200);
  expect(mocks.change).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: expect.stringContaining("own-org") }), "own-org", { plan: "profi", period: "yearly" }, expect.any(Number));
});
it("preserves the idempotency key across retries", async () => {
  const body = { action: "change", plan: "profi", period: "yearly", confirm: true };
  await POST(request(body)); await POST(request(body));
  expect(mocks.change.mock.calls[0][0].idempotencyKey).toBe(mocks.change.mock.calls[1][0].idempotencyKey);
});
it("cancels or resumes only the session firm's subscription", async () => {
  await POST(request({ action: "cancel", confirm: true })); await POST(request({ action: "resume" }));
  expect(mocks.cancel).toHaveBeenNthCalledWith(1, expect.anything(), "own-org", true);
  expect(mocks.cancel).toHaveBeenNthCalledWith(2, expect.anything(), "own-org", false);
});
it("exposes a read-only trial charge preview and handles provider failure", async () => {
  const response = await POST(request({ action: "preview_end_trial" }));
  expect(await response.json()).toMatchObject({ dueNowHalere: 99000 });
  mocks.preview.mockRejectedValue(new Error("test outage"));
  expect((await POST(request({ action: "preview", plan: "profi", period: "monthly" }))).status).toBe(502);
});
