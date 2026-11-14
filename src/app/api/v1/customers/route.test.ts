import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), record: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth-api-key", () => ({ getApiKeyIdentity: mocks.auth, recordApiKeyRequest: mocks.record, ApiKeyError: class extends Error {} }));
vi.mock("@/lib/structured-log", () => ({ logError: vi.fn(), requestId: () => "request-test" }));
import { GET, POST } from "./route";
import { GET as GET_ONE, PATCH } from "./[id]/route";
import { apiOperationId, stableApiHash } from "@/lib/public-api-input";
const org = "22222222-2222-4222-8222-222222222222", user = "11111111-1111-4111-8111-111111111111";
const id = "33333333-3333-4333-8333-333333333333";
const customer = { id, name: "Customer", email: "customer@example.com", phone: null, address: "Address", ico: "12345670", dic: null, created_at: "2026-11-14T10:00:00Z", updated_at: "2026-11-14T10:00:00Z" };
const payload = { name: " Customer ", address: " Address ", email: "CUSTOMER@EXAMPLE.COM", ico: "12345670" };
const normalized = { name: "Customer", address: "Address", email: "customer@example.com", ico: "12345670", dic: "" };
const context = { params: Promise.resolve({ id }) };
function chain(data: unknown, error: unknown = null) {
  const result: Record<string, unknown> = {};
  for (const key of ["select", "eq", "order", "limit", "or"]) result[key] = vi.fn(() => result);
  result.maybeSingle = vi.fn(async () => ({ data, error }));
  result.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve);
  return result;
}
const request = (method: string, body?: unknown, key = "customer-order-1") => new Request(`https://example.com/api/v1/customers`, { method, headers: { "content-type": "application/json", "idempotency-key": key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ organizationId: org, actingUserId: user, user: { id: user }, service: { from: mocks.from, rpc: mocks.rpc } });
  mocks.record.mockResolvedValue(undefined);
  mocks.rpc.mockResolvedValue({ data: { customer, replayed: false }, error: null });
  mocks.from.mockReturnValue(chain(customer));
});
describe("public customer API", () => {
  it("scopes cursor pagination to the authenticated organization and emits safe fields", async () => {
    const query = chain([{ ...customer, notes: "private" }, { ...customer, id: user }]); mocks.from.mockReturnValue(query);
    const response = await GET(new Request("https://example.com/api/v1/customers?limit=1"));
    expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), "customers:read");
    expect(query.eq).toHaveBeenCalledWith("organization_id", org);
    expect(query.order).toHaveBeenCalledWith("created_at");
    expect(query.order).toHaveBeenCalledWith("id");
    expect(await response.json()).toMatchObject({ data: [customer], has_more: true, next_cursor: expect.any(String) });
  });
  it("creates an idempotent request with organization-bound operation ID and normalized content hash", async () => {
    const response = await POST(request("POST", payload));
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("create_api_customer", { target_org: org, actor_user: user, request_uuid: apiOperationId(org, "customers", "customer-order-1"), payload_hash: stableApiHash(normalized), customer_payload: normalized });
    mocks.rpc.mockResolvedValueOnce({ data: { customer: { ...customer, email: "edited@example.com" }, replayed: true }, error: null });
    const replay = await POST(request("POST", payload));
    expect(replay.status).toBe(200); expect(await replay.json()).toMatchObject({ replayed: true, customer: { email: "edited@example.com" } });
  });
  it("maps content and ICO conflicts without leaking database messages", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "API_IDEMPOTENCY_CONFLICT" } });
    expect((await POST(request("POST", payload))).status).toBe(409);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "private SQL constraint" } });
    const response = await POST(request("POST", payload));
    expect(response.status).toBe(409); expect(await response.text()).not.toContain("private SQL");
  });
  it("rejects unsupported creation fields and missing idempotency keys before writes", async () => {
    expect((await POST(request("POST", { ...payload, organization_id: user }))).status).toBe(400);
    expect((await POST(request("POST", payload, ""))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not reveal another organization's customer or call its update transaction", async () => {
    const query = chain(null); mocks.from.mockReturnValue(query);
    expect((await GET_ONE(request("GET"), context)).status).toBe(404);
    expect((await PATCH(request("PATCH", { phone: "123" }), context)).status).toBe(404);
    expect(query.eq).toHaveBeenCalledWith("organization_id", org);
    expect(query.eq).toHaveBeenCalledWith("id", id);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("updates only contact fields through the existing tenant-scoped transaction", async () => {
    mocks.from.mockReturnValueOnce(chain(customer)).mockReturnValueOnce(chain({ name: "Issuer", email: "issuer@example.org" })).mockReturnValueOnce(chain({ ...customer, email: "new@example.com", phone: "123" }));
    mocks.rpc.mockResolvedValueOnce({ data: { customer: { ...customer, email: "new@example.com", phone: "123" }, updated_invoice_count: 2 }, error: null });
    const response = await PATCH(request("PATCH", { email: " NEW@EXAMPLE.COM ", phone: " 123 " }), context);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("update_customer_contact", { target_org: org, actor_user: user, target_customer: id, change_email: true, new_email: "new@example.com", change_phone: true, new_phone: "123" });
    expect(await response.json()).toMatchObject({ customer: { ...customer,email:"new@example.com",phone:"123" },updated_invoice_count: 2 });
  });
  it("rejects changing immutable identity or using issuer contact as reminder recipient", async () => {
    expect((await PATCH(request("PATCH", { name: "Other identity" }), context)).status).toBe(400);
    mocks.from.mockReturnValueOnce(chain(customer)).mockReturnValueOnce(chain({ name: "Issuer", email: "issuer@example.org" }));
    expect((await PATCH(request("PATCH", { email: "issuer@example.org" }), context)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
