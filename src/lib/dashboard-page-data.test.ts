import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDashboardPageData } from "./dashboard-page-data";
import type { RequestIdentity } from "./auth";

let rpc: ReturnType<typeof vi.fn>;
let identity: RequestIdentity;
beforeEach(() => {
  rpc = vi.fn(async () => ({ data: { invoice_count: 1001, active_count: 55, charts: {} }, error: null }));
  identity = {
    membership: { organization_id: "org-one", role: "admin" },
    user: { id: "user-one" },
    service: { rpc },
  } as unknown as RequestIdentity;
});
describe("dashboard snapshot loader", () => {
  it("loads totals and charts with one tenant-scoped RPC and no invoice paging", async () => {
    const result = await loadDashboardPageData(identity, { from: "2026-08-01", to: "2026-10-19" });
    expect(result.invoice_count).toBe(1001);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("dashboard_snapshot", {
      target_org: "org-one", actor_user: "user-one", period_from: "2026-08-01", period_to: "2026-10-19",
    });
  });
  it("does not impose an artificial historical cutoff", async () => {
    await loadDashboardPageData(identity, { from: null, to: "2026-10-19" });
    expect(rpc.mock.calls[0][1].period_from).toBeNull();
  });
  it("fails atomically rather than presenting partial totals", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Unavailable" } });
    await expect(loadDashboardPageData(identity, { from: null, to: "2026-10-19" })).rejects.toMatchObject({ status: 500 });
  });
  it("preserves the unfiltered contract for Esko and existing consumers", async () => {
    await loadDashboardPageData(identity);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("dashboard_summary", { target_org: "org-one", actor_user: "user-one" });
  });
  it("rejects unauthenticated callers before reading", async () => {
    await expect(loadDashboardPageData(null, { from: null, to: "2026-10-19" })).rejects.toMatchObject({ status: 401 });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects invalid roles before reading", async () => {
    const forbidden = { ...identity, membership: { ...identity.membership, role: null } } as unknown as RequestIdentity;
    await expect(loadDashboardPageData(forbidden, { from: null, to: "2026-10-19" })).rejects.toMatchObject({ status: 403 });
    expect(rpc).not.toHaveBeenCalled();
  });
});
