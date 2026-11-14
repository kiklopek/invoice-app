import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain, fakeIdentity, fakeRequest } from "../../payments/__test-helpers__";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), rpc: vi.fn(), from: vi.fn(), select: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.identity }));
import { DELETE, GET, POST } from "./route";

const metadata = { id: "11111111-1111-4111-8111-111111111111", name: "E-shop", key_prefix: "abcdefgh", scopes: ["invoices:write"], created_at: "2026-11-14T12:00:00Z", last_used_at: null, expires_at: null, revoked_at: null };
const post = (body: unknown) => POST(fakeRequest("http://localhost/api/settings/api-keys", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockResolvedValue({ data: metadata, error: null });
  mocks.select.mockReturnValue(fakeChain({ data: [metadata], error: null }));
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.identity.mockResolvedValue(fakeIdentity({ service: { rpc: mocks.rpc, from: mocks.from } }));
});

describe("company integration key management", () => {
  it("explains missing database activation instead of reporting an ordinary load failure", async () => {
    mocks.select.mockReturnValue(fakeChain({ data: null, error: { code: "PGRST205", message: "organization_api_keys missing from schema cache" } }));
    const response = await GET(new Request("http://localhost/api/settings/api-keys"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "api_setup_required", error: expect.stringContaining("databázová aktualizace") });
  });

  it.each(["PGRST202", "42883"])("explains missing key RPC %s without returning a generated secret", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "function not found" } });
    const response = await post({ name: "E-shop", scopes: ["invoices:read"] });
    const result = await response.json();
    expect(response.status).toBe(503);
    expect(result.code).toBe("api_setup_required");
    expect(result).not.toHaveProperty("key");
  });

  it.each(["accounting", "viewer"] as const)("denies %s access to every management operation", async role => {
    mocks.identity.mockResolvedValue(fakeIdentity({ role }));
    expect((await GET(new Request("http://localhost/api/settings/api-keys"))).status).toBe(403);
    expect((await post({ name: "E-shop", scopes: ["invoices:write"] })).status).toBe(403);
    expect((await DELETE(fakeRequest("http://localhost/api/settings/api-keys", { method: "DELETE", body: JSON.stringify({ id: metadata.id }) }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires an authenticated session", async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await post({ name: "E-shop", scopes: ["invoices:write"] })).status).toBe(401);
  });

  it("shows the secret once and passes only a hash to the atomic creation RPC", async () => {
    const response = await post({ name: " E-shop ", scopes: ["invoices:read", "invoices:write"], expires_at: null });
    const payload = await response.json();
    expect(response.status).toBe(201);
    expect(payload.key).toMatch(/^spl_[A-Za-z0-9_-]{43}$/);
    expect(payload.api_key).toEqual(metadata);
    expect(mocks.rpc).toHaveBeenCalledWith("create_organization_api_key", expect.objectContaining({
      target_org: "22222222-2222-4222-8222-222222222222", actor_user: "11111111-1111-4111-8111-111111111111", key_name: "E-shop", secret_hash: expect.stringMatching(/^[0-9a-f]{64}$/), granted_scopes: ["invoices:read", "invoices:write"],
    }));
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(payload.key);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("lists explicit metadata fields without hashes or secrets", async () => {
    const response = await GET(new Request("http://localhost/api/settings/api-keys"));
    expect(await response.json()).toEqual({ keys: [metadata] });
    expect(mocks.select.mock.calls[0][0]).not.toContain("key_hash");
    expect(mocks.select.mock.calls[0][0]).not.toContain("*");
  });

  it.each([
    { name: "", scopes: ["invoices:write"] },
    { name: "E-shop", scopes: [] },
    { name: "E-shop", scopes: ["organization:admin"] },
    { name: "E-shop", scopes: ["invoices:write"], expires_at: "2020-01-01T00:00:00Z" },
  ])("rejects invalid key settings", async body => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("revokes a key with an organization-scoped RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const response = await DELETE(fakeRequest("http://localhost/api/settings/api-keys", { method: "DELETE", body: JSON.stringify({ id: metadata.id }) }));
    expect(await response.json()).toEqual({ revoked: true });
    expect(mocks.rpc).toHaveBeenCalledWith("revoke_organization_api_key", expect.objectContaining({ target_key: metadata.id, target_org: "22222222-2222-4222-8222-222222222222" }));
  });

  it("returns 404 for a key from another organization", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
    expect((await DELETE(fakeRequest("http://localhost/api/settings/api-keys", { method: "DELETE", body: JSON.stringify({ id: metadata.id }) }))).status).toBe(404);
  });

  it("rejects a cross-origin mutation", async () => {
    const response = await POST(new Request("http://localhost/api/settings/api-keys", { method: "POST", headers: { origin: "https://other.example" }, body: JSON.stringify({ name: "E-shop", scopes: ["invoices:write"] }) }));
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
