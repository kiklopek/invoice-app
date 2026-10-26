import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), search: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.identity }));
vi.mock("@/lib/workspace-search-data", () => ({
  loadWorkspaceSearch: mocks.search,
}));
import { GET } from "./route";
import { PageDataError } from "@/lib/dashboard-page-data";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({
    membership: { organization_id: "own-org" },
  });
  mocks.search.mockResolvedValue({ results: [], unavailable: [] });
});
const request = (q = "stusek") =>
  new Request(
    `https://app.splatno.cz/api/search?q=${encodeURIComponent(q)}&organization_id=forged`,
  );
it("authenticates before searching", async () => {
  mocks.identity.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  expect(mocks.search).not.toHaveBeenCalled();
});
it.each(["x".repeat(101), "bad\u0000query"])(
  "rejects invalid input before data access",
  async (q) => {
    expect((await GET(request(q))).status).toBe(400);
    expect(mocks.search).not.toHaveBeenCalled();
  },
);
it("uses only the server identity and disables shared caching", async () => {
  const response = await GET(request(" Štůšek "));
  expect(mocks.search).toHaveBeenCalledWith(
    await mocks.identity.mock.results[0].value,
    "Štůšek",
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.status).toBe(200);
});
it("returns a retryable error when search is unavailable", async () => {
  mocks.search.mockRejectedValue(new PageDataError("Nedostupné", 503));
  expect((await GET(request())).status).toBe(503);
});
