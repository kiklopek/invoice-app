import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain, fakeIdentity, fakeRequest, SOME_UUID } from "../../payments/__test-helpers__";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.identity, canManageInvoices: (role: string) => ["admin", "accounting"].includes(role) }));
import { PATCH } from "./route";

const request = (body: unknown, origin?: string) => fakeRequest(`http://localhost/api/customers/${SOME_UUID}`, {
  method: "PATCH", body: JSON.stringify(body), origin,
});
const call = (body: unknown, origin?: string) => PATCH(request(body, origin), { params: Promise.resolve({ id: SOME_UUID }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("REMINDER_TEST_RECIPIENTS", "");
  mocks.identity.mockResolvedValue(fakeIdentity({ service: { from: mocks.from, rpc: mocks.rpc } }));
  mocks.from.mockReturnValue(fakeChain({ data: { email: "info@hlavica.cz" }, error: null }));
  mocks.rpc.mockResolvedValue({ data: { customer: { id: SOME_UUID, email: "customer@example.cz", phone: null }, updated_invoice_count: 2 }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("customer contact editing", () => {
  it("requires same origin, a session and a managing role", async () => {
    expect((await call({ email: "customer@example.cz" }, "https://other.example")).status).toBe(403);
    mocks.identity.mockResolvedValue(null);
    expect((await call({ email: "customer@example.cz" })).status).toBe(401);
    mocks.identity.mockResolvedValue(fakeIdentity({ role: "viewer" }));
    expect((await call({ email: "customer@example.cz" })).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects blank, malformed, multiple and oversized email addresses", async () => {
    for (const email of [null, 1, "", " ", "wrong", "one@@example.cz", "a@example.cz,b@example.cz", `${"a".repeat(250)}@example.cz`]) {
      expect((await call({ email })).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("updates email and phone together through the organization-scoped transaction", async () => {
    const response = await call({ email: " CUSTOMER@EXAMPLE.CZ ", phone: " 123 " });
    expect(response.status).toBe(200);
    expect((await response.json()).updated_invoice_count).toBe(2);
    expect(mocks.rpc).toHaveBeenCalledWith("update_customer_contact", {
      target_org: "22222222-2222-4222-8222-222222222222", actor_user: SOME_UUID,
      target_customer: SOME_UUID, change_email: true, new_email: "customer@example.cz",
      change_phone: true, new_phone: "123",
    });
  });
  it("retains phone-only updates and clearing without changing email", async () => {
    expect((await call({ phone: null })).status).toBe(200);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ change_email: false, new_email: null, change_phone: true, new_phone: null });
  });
  it("permits only the enabled testing address on the issuer domain", async () => {
    expect((await call({ email: "adam@hlavica.cz" })).status).toBe(400);
    vi.stubEnv("REMINDER_TEST_RECIPIENTS", "adam@hlavica.cz");
    expect((await call({ email: "adam@hlavica.cz" })).status).toBe(200);
    expect((await call({ email: "info@hlavica.cz" })).status).toBe(400);
    expect((await call({ email: "adam@mail.hlavica.cz" })).status).toBe(400);
  });
  it("reports missing customers and transaction failures", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await call({ email: "customer@example.cz" })).status).toBe(404);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "transaction failed" } });
    const response = await call({ email: "customer@example.cz" });
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("customer_contact_write_failed");
  });
});
