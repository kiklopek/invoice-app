import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.identity }));
import { GET, PATCH } from "./route";
const eventId = "00000000-0000-4000-8000-000000000001";
const feed = { items: [{ id: eventId, created_at: "2026-10-23T10:00:00Z" }], total: 1, unread_count: 1, has_more: false, through: "2026-10-23T10:01:00Z" };
const get = (query = "") => GET(new Request(`http://localhost/api/notifications${query}`));
const patch = (body: unknown, origin = "http://localhost") => PATCH(new Request("http://localhost/api/notifications", { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.identity.mockResolvedValue({ user: { id: "user-a" }, membership: { organization_id: "org-a", role: "viewer" }, service: { rpc: mocks.rpc, from: mocks.from } });
  mocks.rpc.mockResolvedValue({ data: feed, error: null });
  mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) });
});
afterEach(() => vi.unstubAllEnvs());
describe("notification API security and read state", () => {
  it("serves explicitly enabled localhost samples without notification database calls", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_NOTIFICATIONS_PREVIEW", "true");
    const response = await get();
    const preview = await response.json();
    expect(preview.preview).toBe(true);
    expect(preview.unread_count).toBe(5);
    expect(mocks.from).toHaveBeenCalledWith("invoices");
    expect(preview.items.find((item: { type: string }) => item.type === "invoice_overdue").href).toBe("/invoices");
    const marked = await patch({ ids: [preview.items[0].id] });
    expect(await marked.json()).toEqual({ changed: 1 });
    expect(marked.headers.get("set-cookie")).toContain("HttpOnly");
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.identity.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });
  it("requires login and rejects cross-origin writes before data access", async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await get()).status).toBe(401); expect((await patch({ ids: [eventId] })).status).toBe(401);
    expect((await patch({ ids: [eventId] }, "https://foreign.invalid")).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses server organization and actor even with forged request parameters", async () => {
    const response = await get("?target_org=foreign&actor_user=another&limit=8");
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("notification_feed", expect.objectContaining({ target_org: "org-a", actor_user: "user-a" }));
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    await patch({ ids: [eventId], target_org: "foreign", actor_user: "another" });
    expect(mocks.rpc).toHaveBeenLastCalledWith("read_notifications", { target_org: "org-a", actor_user: "user-a", event_ids: [eventId], through_time: null });
  });
  it.each(["?limit=0", "?limit=10000", "?limit=1.2", "?unread=oops", "?cursor=invalid"])("rejects invalid paging %s", async query => {
    expect((await get(query)).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("supports stable cursor pages and unread-only feeds", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...feed, has_more: true }, error: null });
    const result = await (await get("?unread=true")).json();
    await get(`?cursor=${result.next_cursor}`);
    expect(mocks.rpc).toHaveBeenLastCalledWith("notification_feed", expect.objectContaining({ before_time: feed.items[0].created_at, before_id: eventId }));
  });
  it.each([{}, [], { ids: [] }, { ids: ["bad"] }, { all: true }, { all: true, through: "not a date" }, { ids: [eventId], all: true, through: feed.through }])("rejects invalid read mutation %j", async body => {
    expect((await patch(body)).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses snapshot cutoff for mark-all so a concurrent event stays unread", async () => {
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    expect((await patch({ all: true, through: feed.through })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("read_notifications", { target_org: "org-a", actor_user: "user-a", event_ids: null, through_time: feed.through });
  });
  it("reports denied writes, transient read errors and retries without success state", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect((await patch({ ids: [eventId] })).status).toBe(403);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    expect((await get()).status).toBe(503);
    expect((await get()).status).toBe(200);
  });
});
