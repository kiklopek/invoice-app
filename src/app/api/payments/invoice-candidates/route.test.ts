import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeIdentity, fakeRequest } from "../__test-helpers__";

const mocks = vi.hoisted(() => ({ getRequestIdentity: vi.fn() }));

vi.mock("@/lib/auth", async () => {
  const roleAccess = await import("@/lib/role-access");
  return {
    getRequestIdentity: mocks.getRequestIdentity,
    canManageInvoices: roleAccess.canManageInvoices,
  };
});

const { GET } = await import("./route");

const URL_ = "https://app.splatno.cz/api/payments/invoice-candidates?q=test";

describe("GET /api/payments/invoice-candidates", () => {
  beforeEach(() => mocks.getRequestIdentity.mockReset());
  afterEach(() => vi.unstubAllEnvs());

  it("rejects an unauthenticated request", async () => {
    mocks.getRequestIdentity.mockResolvedValue(null);
    const response = await GET(fakeRequest(URL_));
    expect(response.status).toBe(401);
  });

  it("rejects a viewer", async () => {
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ role: "viewer" }));
    const response = await GET(fakeRequest(URL_));
    expect(response.status).toBe(403);
  });

  it("rejects when GPC_IMPORT_ENABLED=false even for accounting/admin", async () => {
    vi.stubEnv("GPC_IMPORT_ENABLED", "false");
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ role: "admin" }));
    const response = await GET(fakeRequest(URL_));
    expect(response.status).toBe(403);
  });

  it("ranks candidates for the payment being matched", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { invoices: [], total: 0 }, error: null });
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ role: "accounting", service: { rpc } }));
    const prefer = "33333333-3333-4333-8333-333333333333";
    const response = await GET(fakeRequest(`https://app.splatno.cz/api/payments/invoice-candidates?q=&page=2&amount=1250.50&currency=czk&vs=0002600194&name=${encodeURIComponent("DREVOSTAVBY NOVAK")}&prefer=${prefer}`));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("rank_open_invoice_candidates", expect.objectContaining({
      page_number: 2, payment_amount: 1250.5, payment_currency: "CZK", payment_vs: "0002600194",
      payment_name: "DREVOSTAVBY NOVAK", prefer_invoice_ids: [prefer],
    }));
  });

  it("rejects malformed payment context instead of guessing", async () => {
    const rpc = vi.fn();
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ role: "admin", service: { rpc } }));
    for (const bad of ["amount=abc", "currency=CZKK", "prefer=not-a-uuid", `vs=${"1".repeat(21)}`]) {
      const response = await GET(fakeRequest(`https://app.splatno.cz/api/payments/invoice-candidates?${bad}`));
      expect(response.status, bad).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});
