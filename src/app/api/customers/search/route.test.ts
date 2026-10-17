import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), rpc: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), or: vi.fn(), order: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.identity }));
vi.mock("@/lib/structured-log", () => ({ logError: vi.fn(), requestId: () => "search-test" }));
import { GET } from "./route";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockReturnValue({ select: mocks.select }); mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ or: mocks.or }); mocks.or.mockReturnValue({ order: mocks.order }); mocks.order.mockReturnValue({ limit: mocks.limit });
  mocks.identity.mockResolvedValue({ user: { id: "user" }, membership: { organization_id: "own-org", role: "accounting" }, service: { rpc: mocks.rpc, from: mocks.from } });
});
const request = (query = "novak") => new Request("https://splatno.cz/api/customers/search?q=" + encodeURIComponent(query));
it("uses the migrated RPC when available", async () => {
  mocks.rpc.mockResolvedValue({ data: [{ id: "customer" }], error: null });
  expect(await (await GET(request())).json()).toEqual({ customers: [{ id: "customer" }] });
  expect(mocks.from).not.toHaveBeenCalled();
});
it.each(["PGRST202", "42883"])("keeps search usable before migration (%s) and scopes the fallback to the organization", async (code) => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code } });
  mocks.limit.mockResolvedValue({ data: [{ id: "own-customer" }], error: null });
  expect(await (await GET(request("a_b,or(id.eq.1)"))).json()).toEqual({ customers: [{ id: "own-customer" }] });
  expect(mocks.eq).toHaveBeenCalledWith("organization_id", "own-org");
  expect(mocks.limit).toHaveBeenCalledWith(10);
  const filter = mocks.or.mock.calls[0][0] as string;
  expect(filter).not.toContain("("); expect(filter).not.toContain(")"); expect(filter).toContain("a\\_b");
  expect(filter.split(",")).toHaveLength(4);
});
it("does not hide permission failures behind fallback queries", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect((await GET(request())).status).toBe(500);
  expect(mocks.from).not.toHaveBeenCalled();
});
it("requires authentication before querying", async () => {
  mocks.identity.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
