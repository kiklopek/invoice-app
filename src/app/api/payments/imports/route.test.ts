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

const { GET, POST } = await import("./route");

const URL_ = "https://app.splatno.cz/api/payments/imports";

function uploadRequest(origin?: string) {
  const form = new FormData();
  form.set("file", new File(["074..."], "vypis.gpc"));
  return fakeRequest(URL_, { method: "POST", origin: origin ?? null, body: form as unknown as BodyInit });
}

describe("POST /api/payments/imports (upload a statement)", () => {
  beforeEach(() => mocks.getRequestIdentity.mockReset());
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a cross-origin request before touching identity or the database", async () => {
    const response = await POST(uploadRequest("https://evil.example"));
    expect(response.status).toBe(403);
    expect(mocks.getRequestIdentity).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    mocks.getRequestIdentity.mockResolvedValue(null);
    const response = await POST(uploadRequest());
    expect(response.status).toBe(401);
  });

  it("rejects a viewer -- import requires accounting/admin", async () => {
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ role: "viewer" }));
    const response = await POST(uploadRequest());
    expect(response.status).toBe(403);
  });

  it("rejects accounting/admin alike when GPC_IMPORT_ENABLED=false, regardless of role", async () => {
    vi.stubEnv("GPC_IMPORT_ENABLED", "false");
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ role: "admin" }));
    const response = await POST(uploadRequest());
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("GPC import");
  });

  it("rejects a role excluded by GPC_IMPORT_ROLES even though canManageInvoices would allow it", async () => {
    vi.stubEnv("GPC_IMPORT_ROLES", "admin");
    mocks.getRequestIdentity.mockResolvedValue(fakeIdentity({ role: "accounting" }));
    const response = await POST(uploadRequest());
    expect(response.status).toBe(403);
  });
});

describe("GET /api/payments/imports (archive list)", () => {
  beforeEach(() => mocks.getRequestIdentity.mockReset());

  it("rejects an unauthenticated request", async () => {
    mocks.getRequestIdentity.mockResolvedValue(null);
    const response = await GET(fakeRequest(URL_));
    expect(response.status).toBe(401);
  });
});
