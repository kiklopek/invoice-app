import { beforeEach, describe, expect, it, vi } from "vitest";
import { OTHER_UUID, SOME_UUID, fakeIdentity, fakeRequest } from "./__test-helpers__";

const mocks = vi.hoisted(() => ({ getRequestIdentity: vi.fn() }));

// src/lib/auth.ts starts with `import "server-only"`, which errors outside a
// real Next.js server context (including plain vitest) -- so the mock can't
// re-import the real module via vi.mock's importOriginal. canManageInvoices
// is pure role logic re-exported from @/lib/role-access (no "server-only"
// guard there), so it's imported directly to keep that logic genuinely
// exercised; only the network-touching getRequestIdentity is faked.
vi.mock("@/lib/auth", async () => {
  const roleAccess = await import("@/lib/role-access");
  return {
    getRequestIdentity: mocks.getRequestIdentity,
    canManageInvoices: roleAccess.canManageInvoices,
  };
});

const { PATCH, DELETE } = await import("./route");

const URL_ = "https://app.splatno.cz/api/payments";

describe("PATCH /api/payments (assign a bank payment to an invoice)", () => {
  beforeEach(() => mocks.getRequestIdentity.mockReset());

  it("rejects a cross-origin request before touching identity or the database", async () => {
    const response = await PATCH(
      fakeRequest(URL_, {
        method: "PATCH",
        origin: "https://evil.example",
        body: JSON.stringify({ payment_id: SOME_UUID, invoice_id: OTHER_UUID }),
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.getRequestIdentity).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    mocks.getRequestIdentity.mockResolvedValue(null);
    const response = await PATCH(
      fakeRequest(URL_, {
        method: "PATCH",
        body: JSON.stringify({ payment_id: SOME_UUID, invoice_id: OTHER_UUID }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a viewer -- payment matching requires accounting/admin", async () => {
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ role: "viewer" }));
    const response = await PATCH(
      fakeRequest(URL_, {
        method: "PATCH",
        body: JSON.stringify({ payment_id: SOME_UUID, invoice_id: OTHER_UUID }),
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe("DELETE /api/payments (release a bank payment)", () => {
  beforeEach(() => mocks.getRequestIdentity.mockReset());

  it("rejects a cross-origin request", async () => {
    const response = await DELETE(
      fakeRequest(URL_, {
        method: "DELETE",
        origin: "https://evil.example",
        body: JSON.stringify({ payment_id: SOME_UUID }),
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.getRequestIdentity).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    mocks.getRequestIdentity.mockResolvedValue(null);
    const response = await DELETE(
      fakeRequest(URL_, { method: "DELETE", body: JSON.stringify({ payment_id: SOME_UUID }) }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a viewer", async () => {
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ role: "viewer" }));
    const response = await DELETE(
      fakeRequest(URL_, { method: "DELETE", body: JSON.stringify({ payment_id: SOME_UUID }) }),
    );
    expect(response.status).toBe(403);
  });
});
