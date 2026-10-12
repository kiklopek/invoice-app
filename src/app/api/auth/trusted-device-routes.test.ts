import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChain, fakeRequest } from "../payments/__test-helpers__";

// Routy přihlášení a důvěryhodné zařízení: po zadání kódu se zařízení
// zapamatuje, další přihlášení heslem na něm kód nechce.
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  membership: vi.fn(),
  trust: vi.fn(),
  setDevice: vi.fn(),
  setMfa: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getAuthenticatedSession: mocks.session, resolveMembership: mocks.membership }));
vi.mock("@/lib/email-mfa-server", () => ({
  trustDeviceSession: mocks.trust,
  setTrustedDeviceCookie: mocks.setDevice,
  setVerifiedEmailMfaCookie: mocks.setMfa,
  sendEmailMfaCode: mocks.send,
  requireEmailMfaSecret: () => "s".repeat(48),
  getEmailMfaConfiguration: () => ({ apiKey: "re_test", from: "test@splatno.cz" }),
}));

import { POST as access } from "./access/route";
import { POST as send } from "./email-mfa/send/route";
import { POST as verify } from "./email-mfa/verify/route";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "33333333-3333-4333-8333-333333333333";

function session(service: unknown = {}) {
  return { user: { id: userId, user_metadata: {} }, email: "jana@firma.cz", sessionId, service };
}
const post = (path: string, body?: unknown) =>
  fakeRequest(`http://localhost${path}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.membership.mockResolvedValue(null);
});

describe("po hesle (/api/auth/access)", () => {
  it("důvěryhodné zařízení přeskočí kód", async () => {
    mocks.session.mockResolvedValue(session());
    mocks.trust.mockResolvedValue(true);
    const body = await (await access(post("/api/auth/access"))).json();
    expect(body.mfa_bypassed).toBe(true);
    expect(mocks.trust).toHaveBeenCalledWith({ userId, sessionId });
  });

  it("nové zařízení kód chce", async () => {
    mocks.session.mockResolvedValue(session());
    mocks.trust.mockResolvedValue(false);
    expect((await (await access(post("/api/auth/access"))).json()).mfa_bypassed).toBe(false);
  });
});

describe("odeslání kódu (/api/auth/email-mfa/send)", () => {
  it("na důvěryhodném zařízení kód neposílá a rovnou ověří", async () => {
    const service = { rpc: vi.fn(), from: vi.fn() };
    mocks.session.mockResolvedValue(session(service));
    mocks.trust.mockResolvedValue(true);
    const response = await send(post("/api/auth/email-mfa/send"));
    expect(await response.json()).toMatchObject({ verified: true });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(service.rpc).not.toHaveBeenCalled();
  });
});

describe("ověření kódu (/api/auth/email-mfa/verify)", () => {
  function serviceWith(status: string) {
    return {
      from: vi.fn(() => fakeChain({ data: { id: "44444444-4444-4444-8444-444444444444" }, error: null })),
      rpc: vi.fn(async () => ({ data: status, error: null })),
    };
  }

  it("správný kód zapamatuje zařízení", async () => {
    mocks.session.mockResolvedValue(session(serviceWith("verified")));
    const response = await verify(post("/api/auth/email-mfa/verify", { code: "123456" }));
    expect(await response.json()).toEqual({ verified: true });
    expect(mocks.setMfa).toHaveBeenCalledWith(userId, sessionId);
    expect(mocks.setDevice).toHaveBeenCalledWith(userId);
  });

  it("špatný kód zařízení nezapamatuje", async () => {
    mocks.session.mockResolvedValue(session(serviceWith("invalid")));
    const response = await verify(post("/api/auth/email-mfa/verify", { code: "123456" }));
    expect(response.status).toBe(400);
    expect(mocks.setDevice).not.toHaveBeenCalled();
  });
});
