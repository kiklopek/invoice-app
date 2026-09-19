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
});
