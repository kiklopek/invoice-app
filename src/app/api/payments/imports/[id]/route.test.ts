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

  // Řádek, který uživatel označí „Nesouvisí s fakturami“ (vlastní převod,
  // vratka od dodavatele), nesmí skončit v knize plateb. Příznak jede uvnitř
  // stávajícího JSON pole reviewed_entries -- signatura RPC se nemění.
  function rpcSpy() {
    const rpc = vi.fn().mockResolvedValue({ data: { id: SOME_UUID, revision: 2 }, error: null });
    return { rpc, identity: fakeIdentity({ service: { rpc } }) };
  }

  it("carries the 'unrelated' flag to the database inside the existing reviewed_entries JSON", async () => {
    const { rpc, identity } = rpcSpy();
    mocks.getRequestIdentity.mockResolvedValue(identity);
    const response = await PATCH(
      fakeRequest(URL_, {
        method: "PATCH",
        body: JSON.stringify({
          revision: 1,
          reviewed_entry_ids: [SOME_UUID, OTHER_UUID],
          unrelated_entry_ids: [OTHER_UUID],
          allocations: [],
        }),
      }),
      context(SOME_UUID),
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "save_bank_statement_allocations",
      expect.objectContaining({
        reviewed_entries: [
          { id: SOME_UUID, unrelated: false },
          { id: OTHER_UUID, unrelated: true },
        ],
        allocation_rows: [],
      }),
    );
  });

  it("keeps the legacy payload when nothing is marked, so it still works against the previous database function", async () => {
    const { rpc, identity } = rpcSpy();
    mocks.getRequestIdentity.mockResolvedValue(identity);
    await PATCH(
      fakeRequest(URL_, {
        method: "PATCH",
        body: JSON.stringify({ revision: 1, reviewed_entry_ids: [SOME_UUID], allocations: [] }),
      }),
      context(SOME_UUID),
    );
    expect(rpc).toHaveBeenCalledWith(
      "save_bank_statement_allocations",
      expect.objectContaining({ reviewed_entries: [SOME_UUID] }),
    );
  });

  it("refuses a row marked unrelated that also carries an invoice allocation -- a contradiction, not something to decide silently", async () => {
    const { rpc, identity } = rpcSpy();
    mocks.getRequestIdentity.mockResolvedValue(identity);
    const response = await PATCH(
      fakeRequest(URL_, {
        method: "PATCH",
        body: JSON.stringify({
          revision: 1,
          reviewed_entry_ids: [SOME_UUID],
          unrelated_entry_ids: [SOME_UUID],
          allocations: [{ entry_id: SOME_UUID, invoice_id: OTHER_UUID, amount: 100, is_manual_partial: false }],
        }),
      }),
      context(SOME_UUID),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Nesouvisí s fakturami");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("explains the database-side refusal instead of a generic failure", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "unrelated_entry_already_booked" } });
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ service: { rpc } }));
    const response = await PATCH(
      fakeRequest(URL_, {
        method: "PATCH",
        body: JSON.stringify({ revision: 1, reviewed_entry_ids: [SOME_UUID], unrelated_entry_ids: [SOME_UUID], allocations: [] }),
      }),
      context(SOME_UUID),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("už zaúčtovaný");
  });
});
