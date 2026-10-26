import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTrustedDeviceToken, EMAIL_MFA_COOKIE, EMAIL_MFA_SESSION_TTL_SECONDS,
  TRUSTED_DEVICE_COOKIE, TRUSTED_EMAIL_MFA_ACCOUNT, verifyEmailMfaToken,
} from "@/lib/email-mfa-core";
import { LOGIN_SESSION_COOKIE, REMEMBER_LOGIN_COOKIE, REMEMBER_LOGIN_TTL_SECONDS, verifyLoginSessionToken } from "@/lib/login-session";

const mocks = vi.hoisted(() => ({ session: vi.fn(), membership: vi.fn(), organization: vi.fn(), setCookie: vi.fn(), jar: new Map<string, string>() }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedSession: mocks.session, resolveMembership: mocks.membership }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  set: mocks.setCookie,
  get: (name: string) => mocks.jar.has(name) ? { value: mocks.jar.get(name) } : undefined,
}) }));

import { POST } from "./route";

const identity = { userId: "verified-user", sessionId: "verified-session" };
const secret = "s".repeat(48);
function request(body?: string, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/auth/access", {
    method: "POST", headers: { origin, "Content-Type": "application/json", Authorization: "Bearer verified-token" }, body,
  });
}
const preference = (remember: boolean) => request(JSON.stringify({ remember }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.jar.clear();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("EMAIL_MFA_SECRET", secret);
  mocks.setCookie.mockImplementation((name: string, value: string) => mocks.jar.set(name, value));
  mocks.session.mockResolvedValue({ user: { id: identity.userId, user_metadata: {} }, email: "person@example.com", sessionId: identity.sessionId });
  mocks.organization.mockResolvedValue({ data: { name: "Example", logo_path: null, vat_payer: true } });
  mocks.membership.mockResolvedValue({ membership: { organization_id: "org", role: "admin" }, service: { from: () => ({ select: () => ({ eq: () => ({ single: mocks.organization }) }) }) } });
});
afterEach(() => vi.unstubAllEnvs());

describe("combined login bootstrap", () => {
  it.each([true, false])("verifies once and sets the requested remember preference (%s)", async (remember) => {
    const response = await POST(preference(remember));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ needsOnboarding: false, mfa_bypassed: false, companyName: "Example", role: "admin" });
    expect(mocks.session).toHaveBeenCalledTimes(1);
    expect(mocks.session).toHaveBeenCalledWith(expect.objectContaining({ requireMfa: false, requireLoginSession: false, accessToken: "verified-token" }));
    expect(mocks.membership).toHaveBeenCalledTimes(1);
    expect(verifyLoginSessionToken(mocks.jar.get(LOGIN_SESSION_COOKIE), { ...identity, secret })).toMatchObject({ remember: false });
    const cookie = mocks.setCookie.mock.calls.find(([name]) => name === LOGIN_SESSION_COOKIE)!;
    expect(cookie[2]).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/" });
    expect(cookie[2]).not.toHaveProperty("maxAge");
    if (remember) expect(verifyLoginSessionToken(mocks.jar.get(REMEMBER_LOGIN_COOKIE), { ...identity, secret })).toMatchObject({ remember: true });
    else expect(mocks.jar.get(REMEMBER_LOGIN_COOKIE)).toBe("");
    expect(mocks.jar.has(EMAIL_MFA_COOKIE)).toBe(false);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([true, false])("trusted-device MFA immediately uses the new remember preference (%s)", async (remember) => {
    mocks.jar.set(TRUSTED_DEVICE_COOKIE, createTrustedDeviceToken({ userId: identity.userId, secret }));
    // Opposite old preference proves the newly written cookie is used.
    if (!remember) {
      await POST(preference(true));
      mocks.setCookie.mockClear();
    }
    const response = await POST(preference(remember));
    expect(await response.json()).toMatchObject({ mfa_bypassed: true });
    const mfa = mocks.setCookie.mock.calls.find(([name]) => name === EMAIL_MFA_COOKIE)!;
    expect(mfa[2].maxAge).toBe(remember ? REMEMBER_LOGIN_TTL_SECONDS : EMAIL_MFA_SESSION_TTL_SECONDS);
    expect(verifyEmailMfaToken({ token: mfa[1], ...identity, secret })).toBe(true);
    expect(verifyEmailMfaToken({ token: mfa[1], ...identity, sessionId: "other", secret })).toBe(false);
  });

  it("requires MFA when the trusted device belongs to another account", async () => {
    mocks.jar.set(TRUSTED_DEVICE_COOKIE, createTrustedDeviceToken({ userId: "other", secret }));
    expect(await (await POST(preference(true))).json()).toMatchObject({ mfa_bypassed: false });
    expect(mocks.jar.has(EMAIL_MFA_COOKIE)).toBe(false);
  });

  it("preserves the existing trusted-account bypass", async () => {
    mocks.session.mockResolvedValue({ user: { id: identity.userId, user_metadata: {} }, email: TRUSTED_EMAIL_MFA_ACCOUNT, sessionId: identity.sessionId });
    expect(await (await POST(preference(false))).json()).toMatchObject({ mfa_bypassed: true });
  });

  it("initializes founders before company onboarding", async () => {
    mocks.membership.mockResolvedValue(null);
    expect(await (await POST(preference(true))).json()).toMatchObject({ needsOnboarding: true, companyName: null, role: null });
    expect(mocks.jar.has(LOGIN_SESSION_COOKIE)).toBe(true);
    expect(mocks.organization).not.toHaveBeenCalled();
  });

  it.each([undefined, "{}"])("keeps bodyless/legacy access callers working (%s)", async (body) => {
    expect((await POST(request(body))).status).toBe(200);
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it.each(['{"remember":"false"}', '{"remember":null}', 'null', '[]', '{broken'])("rejects invalid input before issuing cookies: %s", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it("rejects invalid sessions without setting any cookies", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(preference(true))).status).toBe(401);
    expect(mocks.setCookie).not.toHaveBeenCalled();
    expect(mocks.membership).not.toHaveBeenCalled();
  });

  it("rejects foreign origins before verification", async () => {
    expect((await POST(request('{"remember":true}', "https://foreign.example"))).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it("can retry after a server failure without caching failed verification", async () => {
    mocks.session.mockRejectedValueOnce(new Error("upstream unavailable"));
    await expect(POST(preference(true))).rejects.toThrow("upstream unavailable");
    expect(mocks.setCookie).not.toHaveBeenCalled();
    expect((await POST(preference(true))).status).toBe(200);
    expect(mocks.session).toHaveBeenCalledTimes(2);
  });
});
