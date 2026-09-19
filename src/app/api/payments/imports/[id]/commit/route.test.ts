import { beforeEach, describe, expect, it, vi } from "vitest";
import { SOME_UUID, fakeIdentity, fakeRequest } from "../../../__test-helpers__";

const mocks = vi.hoisted(() => ({ getRequestIdentity: vi.fn() }));

vi.mock("@/lib/auth", async () => {
  const roleAccess = await import("@/lib/role-access");
  return {
    getRequestIdentity: mocks.getRequestIdentity,
    canManageInvoices: roleAccess.canManageInvoices,
  };
});

const { POST } = await import("./route");

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

const URL_ = `https://app.splatno.cz/api/payments/imports/${SOME_UUID}/commit`;
const validBody = JSON.stringify({ revision: 1, acknowledge_account_mismatch: false });

describe("POST /api/payments/imports/[id]/commit", () => {
  beforeEach(() => mocks.getRequestIdentity.mockReset());

  it("rejects a cross-origin request before touching identity or the database", async () => {
    const response = await POST(
      fakeRequest(URL_, { method: "POST", origin: "https://evil.example", body: validBody }),
      context(SOME_UUID),
    );
    expect(response.status).toBe(403);
    expect(mocks.getRequestIdentity).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    mocks.getRequestIdentity.mockResolvedValue(null);
    const response = await POST(fakeRequest(URL_, { method: "POST", body: validBody }), context(SOME_UUID));
    expect(response.status).toBe(401);
  });

  it("rejects a viewer", async () => {
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ role: "viewer" }));
    const response = await POST(fakeRequest(URL_, { method: "POST", body: validBody }), context(SOME_UUID));
    expect(response.status).toBe(403);
  });

  it("is idempotent -- calling commit twice both return the already-committed result, neither is treated as an error", async () => {
    // Mirrors what the real commit_bank_statement_import SQL function does:
    // if the import's status is already 'committed', it returns
    // {status:'committed', idempotent:true} instead of re-running anything.
    const rpc = vi.fn().mockResolvedValue({
      data: { status: "committed", idempotent: true },
      error: null,
    });
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ service: { rpc } }));

    const first = await POST(fakeRequest(URL_, { method: "POST", body: validBody }), context(SOME_UUID));
    const second = await POST(fakeRequest(URL_, { method: "POST", body: validBody }), context(SOME_UUID));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual({ status: "committed", idempotent: true });
    expect(await second.json()).toEqual({ status: "committed", idempotent: true });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
