import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGIN_SESSION_COOKIE, REMEMBER_LOGIN_COOKIE, REMEMBER_LOGIN_TTL_SECONDS, verifyLoginSessionToken } from "@/lib/login-session";

const mocks = vi.hoisted(() => ({ session: vi.fn(), membership: vi.fn(), setCookie: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedSession: mocks.session, getRequestIdentity: mocks.membership }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.setCookie }) }));

import { POST } from "./route";

const identity = { userId: "new-founder", sessionId: "verified-session" };
const secret = "s".repeat(48);
function request(remember: unknown = false, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/auth/session-preference", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json", Authorization: "Bearer verified-access-token" },
    body: JSON.stringify({ remember }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("EMAIL_MFA_SECRET", secret);
  mocks.session.mockResolvedValue({ user: { id: identity.userId }, sessionId: identity.sessionId, boundMembership: null });
  // A verified founder has no company until onboarding. The membership-only
  // helper returns null for this valid account, reproducing the original bug.
  mocks.membership.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("session preference before company onboarding", () => {
  it("stores a verified founder's session before they have a company", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: true });
    expect(mocks.session).toHaveBeenCalledWith({ requireMfa: false, requireLoginSession: false, accessToken: "verified-access-token" });
    expect(mocks.membership).not.toHaveBeenCalled();
    const current = mocks.setCookie.mock.calls.find(([name]) => name === LOGIN_SESSION_COOKIE)!;
    expect(verifyLoginSessionToken(current[1], { ...identity, secret })).toMatchObject({ sub: identity.userId, sid: identity.sessionId, remember: false });
    expect(verifyLoginSessionToken(current[1], { ...identity, sessionId: "different-session", secret })).toBeNull();
    expect(current[2]).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/", secure: false });
    expect(current[2]).not.toHaveProperty("maxAge");
    expect(mocks.setCookie).toHaveBeenCalledWith(REMEMBER_LOGIN_COOKIE, "", expect.objectContaining({ maxAge: 0 }));
  });

  it("binds remembered logins to the verified account and session", async () => {
    expect((await POST(request(true))).status).toBe(200);
    const remembered = mocks.setCookie.mock.calls.find(([name]) => name === REMEMBER_LOGIN_COOKIE)!;
    expect(verifyLoginSessionToken(remembered[1], { ...identity, secret })).toMatchObject({ remember: true });
    expect(remembered[2]).toMatchObject({ httpOnly: true, maxAge: REMEMBER_LOGIN_TTL_SECONDS });
  });

  it("does not issue login cookies for an unauthenticated request", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it("rejects another origin before checking the session", async () => {
    expect((await POST(request(false, "https://another-site.example"))).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it.each(["false", null, 1])("rejects an invalid preference (%s) without writing cookies", async (value) => {
    expect((await POST(request(value))).status).toBe(400);
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });
});
