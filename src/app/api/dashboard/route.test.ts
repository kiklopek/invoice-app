import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.identity }));
import { GET } from "./route";
const request = (query = "to=2026-10-25") => new Request(`http://localhost/api/dashboard?${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({
    user: { id: "actor-a" }, membership: { organization_id: "org-a", role: "admin" },
    service: { rpc: mocks.rpc },
  });
  mocks.rpc.mockResolvedValue({ data: { invoice_count: 1001, charts: { CZK: { monthly: [] } } }, error: null });
});
describe("dashboard composite read API", () => {
  it("returns the complete snapshot in one authenticated tenant-scoped read", async () => {
    const response = await GET(request("to=2026-10-25&target_org=other&actor_user=other"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ invoice_count: 1001, charts: { CZK: { monthly: [] } } });
    expect(mocks.identity).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("dashboard_snapshot", {
      target_org: "org-a", actor_user: "actor-a", period_from: null, period_to: "2026-10-25",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("server-timing")).toContain("data;dur=");
  });
  it.each(["from=bad&to=2026-10-25", "from=2026-10-26&to=2026-10-25", "from=2026-10-01", "to=2026-02-30"])("rejects malformed periods: %s", async query => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires authentication before privileged reads", async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("reports failure rather than returning partial or fabricated balances", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    expect((await GET(request())).status).toBe(500);
  });
  it("retains the legacy unfiltered contract", async () => {
    await GET(request(""));
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("dashboard_summary", { target_org: "org-a", actor_user: "actor-a" });
  });
});
