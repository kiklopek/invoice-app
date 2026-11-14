import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), insert: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));

import { ApiKeyError, generateApiKey, getApiKeyIdentity, recordApiKeyRequest } from "./auth-api-key";

const secret = `spl_${"A".repeat(43)}`;
const valid = {
  status: "ok", key_id: "11111111-1111-4111-8111-111111111111",
  organization_id: "22222222-2222-4222-8222-222222222222",
  acting_user_id: "33333333-3333-4333-8333-333333333333",
  membership_id: "44444444-4444-4444-8444-444444444444", email: "admin@example.com",
  scopes: ["invoices:write"], limit: 120, remaining: 119, reset_at: "2026-11-14T12:01:00.000Z",
};

const request = (key = secret) => new Request("https://www.splatno.com/api/v1/invoices", { headers: { authorization: `Bearer ${key}` } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockResolvedValue({ data: valid, error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.from.mockReturnValue({ insert: mocks.insert });
});

describe("organization API key authentication", () => {
  it("generates a high-entropy secret and stores only its SHA-256 hash", () => {
    const first = generateApiKey();
    const second = generateApiKey();
    expect(first.key).toMatch(/^spl_[A-Za-z0-9_-]{43}$/);
    expect(first.key).not.toBe(second.key);
    expect(first.hash).toBe(createHash("sha256").update(first.key).digest("hex"));
    expect(first.prefix).toBe(first.key.slice(4, 12));
  });

  it.each([undefined, "Bearer unknown", "Basic abc", `Bearer ${secret} extra`])("rejects malformed or missing authorization before any database call", async header => {
    const req = new Request("https://www.splatno.com/api/v1/invoices", { headers: header ? { authorization: header } : {} });
    await expect(getApiKeyIdentity(req, "invoices:write")).rejects.toMatchObject({ status: 401, code: "invalid_api_key" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("authenticates using a hash and the required scope, with a real organization and actor", async () => {
    const identity = await getApiKeyIdentity(request(), "invoices:write");
    expect(mocks.rpc).toHaveBeenCalledWith("authenticate_organization_api_key", {
      target_hash: createHash("sha256").update(secret).digest("hex"), required_scope: "invoices:write",
    });
    expect(identity).toMatchObject({ organizationId: valid.organization_id, keyId: valid.key_id, actingUserId: valid.acting_user_id, membership: { id: valid.membership_id, role: "admin" }, user: { id: valid.acting_user_id }, rateLimit: { limit: 120, remaining: 119 } });
    expect(JSON.stringify(identity)).not.toContain(secret);
  });

  it.each(["invalid", "revoked", "expired", "owner_inactive"])("fails closed for %s keys", async status => {
    mocks.rpc.mockResolvedValue({ data: { status }, error: null });
    await expect(getApiKeyIdentity(request(), "invoices:write")).rejects.toMatchObject({ status: 401 });
  });

  it("distinguishes missing scope from invalid identity", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "forbidden" }, error: null });
    await expect(getApiKeyIdentity(request(), "invoices:send")).rejects.toMatchObject({ status: 403, code: "insufficient_scope" });
  });

  it("returns durable rate limit information", async () => {
    mocks.rpc.mockResolvedValue({ data: { status: "rate_limited", retry_after: 42 }, error: null });
    await expect(getApiKeyIdentity(request(), "invoices:write")).rejects.toMatchObject({ status: 429, code: "rate_limited", retryAfter: 42 });
  });

  it("rejects database failures and malformed successful responses", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "internal" } });
    await expect(getApiKeyIdentity(request(), "invoices:write")).rejects.toBeInstanceOf(ApiKeyError);
    mocks.rpc.mockResolvedValueOnce({ data: { ...valid, organization_id: null }, error: null });
    await expect(getApiKeyIdentity(request(), "invoices:write")).rejects.toMatchObject({ status: 503 });
  });

  it("records sanitized machine-request attribution without a query string or secret", async () => {
    const identity = await getApiKeyIdentity(request(), "invoices:write");
    await recordApiKeyRequest(identity, { requestId: "req-123", method: "POST", path: "/api/v1/invoices?key=secret", status: 201, durationMs: 12.3 });
    expect(mocks.insert).toHaveBeenCalledWith({ organization_id: valid.organization_id, key_id: valid.key_id, request_id: "req-123", method: "POST", path: "/api/v1/invoices", status: 201, duration_ms: 13 });
  });
});
