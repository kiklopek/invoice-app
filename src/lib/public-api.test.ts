import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/auth-api-key", () => ({ getApiKeyIdentity: mocks.auth, recordApiKeyRequest: mocks.record,
  ApiKeyError: class extends Error { constructor(message: string, readonly status: number, readonly code: string, readonly retryAfter?: number) { super(message); } },
}));
vi.mock("@/lib/structured-log", () => ({ logError: vi.fn(), requestId: () => "req-test" }));
import { ApiKeyError } from "./auth-api-key";
import { publicApi, readApiJson } from "./public-api";
import { PublicApiError } from "./public-api-input";
beforeEach(() => { mocks.auth.mockReset().mockResolvedValue({ keyId: "key" }); mocks.record.mockReset().mockResolvedValue(undefined); });
describe("public API boundary", () => {
  it("never invokes an operation when the key lacks authorization", async () => {
    mocks.auth.mockRejectedValue(new ApiKeyError("Zakázáno", 403, "insufficient_scope"));
    const operation = vi.fn();
    const response = await publicApi(new Request("https://example.com/api/v1/invoices"), "invoices:read", operation);
    expect(response.status).toBe(403); expect(operation).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ code: "insufficient_scope", request_id: "req-test" });
  });
  it("provides retry and no-store headers and does not leak unexpected errors", async () => {
    mocks.auth.mockRejectedValue(new ApiKeyError("Zpomalte", 429, "rate_limited", 45));
    const request = new Request("https://example.com/api/v1/invoices");
    const limited = await publicApi(request, "invoices:read", vi.fn());
    expect(limited.headers.get("retry-after")).toBe("45");
    expect(limited.headers.get("cache-control")).toBe("private, no-store");
    mocks.auth.mockResolvedValue({ keyId: "key" });
    const failed = await publicApi(request, "invoices:read", async () => { throw Error("secret SQL connection"); });
    expect(await failed.text()).not.toContain("secret SQL"); expect(failed.status).toBe(503);
  });
  it("records status without request body or query and keeps success independent of telemetry", async () => {
    mocks.record.mockRejectedValue(Error("logging failed"));
    const request = new Request("https://example.com/api/v1/invoices?email=private@example.com");
    const response = await publicApi(request, "invoices:read", async () => Response.json({ data: [] }));
    expect(response.status).toBe(200);
    expect(mocks.record.mock.calls[0][1]).toMatchObject({ path: "/api/v1/invoices", status: 200 });
    expect(response.headers.get("x-request-id")).toBe("req-test");
  });
  it("bounds streamed bodies even without Content-Length and rejects non-JSON", async () => {
    const make = (body: string, type = "application/json") => new Request("https://example.com", { method: "POST", headers: { "content-type": type }, body });
    await expect(readApiJson(make("x".repeat(70_000)))).rejects.toMatchObject({ status: 413 });
    await expect(readApiJson(make("{}", "text/plain"))).rejects.toMatchObject({ status: 415 });
    await expect(readApiJson(make("{"))).rejects.toBeInstanceOf(PublicApiError);
  });
});
