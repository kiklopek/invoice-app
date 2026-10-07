import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeIdentity, fakeRequest } from "../../payments/__test-helpers__";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), limit: vi.fn(), start: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getRequestIdentity: mocks.identity }));
vi.mock("@/lib/auth-rate-limit", () => ({ consumePublicAuthLimit: mocks.limit }));
vi.mock("@/lib/verification-server", () => ({ startDataBoxVerification: mocks.start }));
vi.mock("@/lib/email-mfa-server", () => ({ requireEmailMfaSecret: () => "s".repeat(40) }));
import { POST as start } from "./route";
import { POST as confirm } from "./confirm/route";

const post = (handler: (request: Request) => Promise<Response>, path: string, body: unknown = {}, origin?: string) =>
  handler(fakeRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), origin }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue(fakeIdentity({ service: { rpc: mocks.rpc } }));
  mocks.limit.mockResolvedValue(true);
});

describe("odeslání kódu do datové schránky", () => {
  it("is only for a company admin from the same origin", async () => {
    expect((await post(start, "/api/verification/data-box", {}, "https://evil.example")).status).toBe(403);
    mocks.identity.mockResolvedValue(fakeIdentity({ role: "accounting" }));
    expect((await post(start, "/api/verification/data-box")).status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("falls back to manual verification when ISDS is not connected", async () => {
    mocks.start.mockResolvedValue({ status: "manual" });
    const response = await post(start, "/api/verification/data-box");
    expect(response.status).toBe(202);
    expect((await response.json()).error).toContain("ručně");
  });

  it("returns where the code went", async () => {
    mocks.start.mockResolvedValue({ status: "sent", dataBoxId: "ab12cde", expiresAt: "2026-10-10T00:00:00Z", mismatch: false });
    expect((await (await post(start, "/api/verification/data-box")).json()).dataBoxId).toBe("ab12cde");
  });
});

describe("zadání kódu", () => {
  it("accepts only six digits and checks them in the database, bound to the company", async () => {
    expect((await post(confirm, "/api/verification/data-box/confirm", { code: "12a456" })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: "verified", error: null });
    expect((await post(confirm, "/api/verification/data-box/confirm", { code: "123 456" })).status).toBe(200);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("verify_data_box_code");
    expect(args.target_org).toBe("22222222-2222-4222-8222-222222222222");
    expect(args.candidate_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("explains wrong, expired and locked codes", async () => {
    for (const [status, http] of [["invalid", 400], ["expired", 410], ["locked", 429]] as const) {
      mocks.rpc.mockResolvedValue({ data: status, error: null });
      expect((await post(confirm, "/api/verification/data-box/confirm", { code: "123456" })).status).toBe(http);
    }
  });
});
