import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRequest } from "../../payments/__test-helpers__";

const mocks = vi.hoisted(() => ({ session: vi.fn(), lookup: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedSession: mocks.session }));
vi.mock("@/lib/ares", () => ({ lookupAresSubject: mocks.lookup }));
vi.mock("@/lib/auth-rate-limit", () => ({ consumePublicAuthLimit: mocks.limit }));
import { POST } from "./route";

const call = (ico: unknown, origin?: string) => POST(fakeRequest("http://localhost/api/onboarding/ares", {
  method: "POST", body: JSON.stringify({ ico }), origin,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "founder" } });
  mocks.limit.mockResolvedValue(true);
});

describe("ARES při zakládání firmy", () => {
  it("requires same origin and authentication before any registry lookup", async () => {
    expect((await call("27082440", "https://evil.example")).status).toBe(403);
    mocks.session.mockResolvedValue(null);
    expect((await call("27082440")).status).toBe(401);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it.each(["12345678", "2708244", "letters", null])("rejects invalid IČO %s without consuming a registry request", async (ico) => {
    expect(await (await call(ico)).json()).toEqual({ status: "invalid_ico" });
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("keeps not-found distinct from a registry outage", async () => {
    mocks.lookup.mockResolvedValueOnce({ status: "not_found" }).mockResolvedValueOnce({ status: "unavailable", reason: "timeout" });
    expect((await (await call("27082440")).json()).status).toBe("not_found");
    expect((await (await call("27082440")).json()).status).toBe("unavailable");
  });
  it("does not call ARES after a rate limit", async () => {
    mocks.limit.mockResolvedValue(false);
    expect((await call("27082440")).status).toBe(429);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
});
