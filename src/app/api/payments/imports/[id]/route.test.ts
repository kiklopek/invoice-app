import { beforeEach, describe, expect, it, vi } from "vitest";
import { OTHER_UUID, SOME_UUID, fakeChain, fakeIdentity, fakeRequest } from "../../__test-helpers__";

const mocks = vi.hoisted(() => ({ getRequestIdentity: vi.fn() }));

vi.mock("@/lib/auth", async () => {
  const roleAccess = await import("@/lib/role-access");
  return {
    getRequestIdentity: mocks.getRequestIdentity,
    canManageInvoices: roleAccess.canManageInvoices,
  };
});

const { GET, PATCH } = await import("./route");

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

const URL_ = `https://app.splatno.cz/api/payments/imports/${SOME_UUID}`;

describe("GET /api/payments/imports/[id]", () => {
  beforeEach(() => mocks.getRequestIdentity.mockReset());

  it("rejects an unauthenticated request before touching the database", async () => {
    mocks.getRequestIdentity.mockResolvedValue(null);
    const response = await GET(fakeRequest(URL_), context(SOME_UUID));
    expect(response.status).toBe(401);
  });

  it("does not leak another organization's import -- a row scoped to a different org comes back as not found, not as data", async () => {
    // The fake .from("bank_statement_imports")...single() chain simulates
    // exactly what a real organization_id filter does for a row belonging to
    // someone else's org: no matching row, so PostgREST reports it as an
    // error rather than returning data -- the route must turn that into 404,
    // never into the statement itself.
    mocks.getRequestIdentity.mockResolvedValue(
      fakeIdentity({
        organizationId: OTHER_UUID,
        service: {
          from: () => fakeChain({ data: null, error: { message: "no rows" } }),
        },
      }),
    );
    const response = await GET(fakeRequest(URL_), context(SOME_UUID));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("Import nebyl nalezen.");
  });
});

describe("PATCH /api/payments/imports/[id] (save review allocations)", () => {
  const validBody = JSON.stringify({ revision: 1, reviewed_entry_ids: [], allocations: [] });

  beforeEach(() => mocks.getRequestIdentity.mockReset());

  it("rejects a cross-origin request before touching identity or the database", async () => {
    const response = await PATCH(
      fakeRequest(URL_, { method: "PATCH", origin: "https://evil.example", body: validBody }),
      context(SOME_UUID),
    );
    expect(response.status).toBe(403);
    expect(mocks.getRequestIdentity).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    mocks.getRequestIdentity.mockResolvedValue(null);
    const response = await PATCH(fakeRequest(URL_, { method: "PATCH", body: validBody }), context(SOME_UUID));
    expect(response.status).toBe(401);
  });

  it("rejects a viewer", async () => {
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ role: "viewer" }));
    const response = await PATCH(fakeRequest(URL_, { method: "PATCH", body: validBody }), context(SOME_UUID));
    expect(response.status).toBe(403);
  });
});
