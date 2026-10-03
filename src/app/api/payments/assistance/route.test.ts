import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeIdentity } from "../__test-helpers__";
const mocks = vi.hoisted(() => ({ identity:vi.fn(),origin:vi.fn(),configure:vi.fn(),process:vi.fn() }));
vi.mock("@/lib/auth",() => ({ getRequestIdentity:mocks.identity,canManageInvoices:(role: string) => ["admin","accounting"].includes(role) }));
vi.mock("@/lib/request-security",() => ({ isSameOriginMutation:mocks.origin }));
vi.mock("@/lib/payment-assistance-server",() => ({ configureAssistance:mocks.configure,processAssistanceJob:mocks.process }));
import { GET, POST } from "./route";
const request = (body = {}) => new Request("http://localhost/api/payments/assistance",{ method:"POST",headers:{ "content-type":"application/json" },body:JSON.stringify(body) });
describe("isolated assistance routes", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.origin.mockReturnValue(true); mocks.identity.mockResolvedValue(fakeIdentity()); });
  afterEach(() => vi.unstubAllEnvs());
  it("does not query new tables with the feature disabled", async () => {
    const response = await GET(new Request("http://localhost/api/payments/assistance"));
    expect(response.status).toBe(200); expect((await response.json()).flags.mode).toBe("off");
    expect(mocks.configure).not.toHaveBeenCalled();
    expect((await POST(request({ action:"reevaluate" }))).status).toBe(404);
  });
  it("requires a session, accounting/admin and same-origin mutations", async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/payments/assistance"))).status).toBe(401);
    mocks.identity.mockResolvedValue(fakeIdentity({ role:"viewer" }));
    expect((await GET(new Request("http://localhost/api/payments/assistance"))).status).toBe(403);
    mocks.origin.mockReturnValue(false);
    expect((await POST(request())).status).toBe(403);
  });
  it("does not permit confirmation in shadow mode", async () => {
    const identity = fakeIdentity();
    vi.stubEnv("PAYMENT_ASSISTANCE_ORGANIZATIONS",identity.membership.organization_id);
    vi.stubEnv("PAYMENT_ASSISTANCE_MODE","shadow");
    expect((await POST(request({ action:"decide",proposal_id:"11111111-1111-4111-8111-111111111111",accept:true }))).status).toBe(403);
  });
});
