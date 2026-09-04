import { describe, expect, it } from "vitest";
import {
  LOGIN_SESSION_COOKIE,
  REMEMBER_LOGIN_COOKIE,
  REMEMBER_LOGIN_TTL_SECONDS,
  createLoginSessionToken,
  hasActiveLoginSession,
  isRememberedLogin,
  resolveLoginSessionSecret,
} from "./login-session";

const secret = "a-secure-test-secret-with-more-than-32-characters";
const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const identity = { userId, sessionId, secret, now: 1_000_000 };

function cookieReader(values: Record<string, string>) {
  return {
    get(name: string) {
      const value = values[name];
      return value === undefined ? undefined : { value };
    },
  };
}

describe("login session preference", () => {
  it("rejects an old auth session without an app login cookie", () => {
    expect(hasActiveLoginSession(cookieReader({}), identity)).toBe(false);
  });

  it("accepts a signed current browser session", () => {
    const token = createLoginSessionToken({ ...identity, remember: false });
    expect(hasActiveLoginSession(cookieReader({ [LOGIN_SESSION_COOKIE]: token }), identity)).toBe(true);
  });

  it("accepts a signed remembered login for thirty days", () => {
    const token = createLoginSessionToken({ ...identity, remember: true });
    const cookies = cookieReader({ [REMEMBER_LOGIN_COOKIE]: token });
    expect(hasActiveLoginSession(cookies, identity)).toBe(true);
    expect(isRememberedLogin(cookies, identity)).toBe(true);
    expect(REMEMBER_LOGIN_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it("rejects legacy, tampered, expired and cross-session cookies", () => {
    const token = createLoginSessionToken({ ...identity, remember: true });
    expect(hasActiveLoginSession(cookieReader({ [LOGIN_SESSION_COOKIE]: "active" }), identity)).toBe(false);
    expect(hasActiveLoginSession(cookieReader({ [REMEMBER_LOGIN_COOKIE]: `${token}x` }), identity)).toBe(false);
    expect(hasActiveLoginSession(cookieReader({ [REMEMBER_LOGIN_COOKIE]: token }), { ...identity, now: 5_000_000_000 })).toBe(false);
    expect(hasActiveLoginSession(cookieReader({ [REMEMBER_LOGIN_COOKIE]: token }), { ...identity, sessionId: userId })).toBe(false);
  });

  it("uses a stable development secret but never falls back in production", () => {
    const development = resolveLoginSessionSecret(undefined, { NODE_ENV: "development" });
    expect(development).toBeTruthy();
    expect(development).toBe(resolveLoginSessionSecret(undefined, { NODE_ENV: "development" }));
    expect(resolveLoginSessionSecret(undefined, { NODE_ENV: "production" })).toBeNull();
    expect(resolveLoginSessionSecret(undefined, { VERCEL_ENV: "production" })).toBeNull();
  });
});
