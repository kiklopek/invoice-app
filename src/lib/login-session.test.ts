import { describe, expect, it } from "vitest";
import {
  LOGIN_COOKIE_VALUE,
  LOGIN_SESSION_COOKIE,
  REMEMBER_LOGIN_COOKIE,
  REMEMBER_LOGIN_TTL_SECONDS,
  hasActiveLoginSession,
  isRememberedLogin,
} from "./login-session";

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
    expect(hasActiveLoginSession(cookieReader({}))).toBe(false);
  });

  it("accepts the current browser session", () => {
    expect(hasActiveLoginSession(cookieReader({ [LOGIN_SESSION_COOKIE]: LOGIN_COOKIE_VALUE }))).toBe(true);
  });

  it("accepts remembered login for thirty days", () => {
    const cookies = cookieReader({ [REMEMBER_LOGIN_COOKIE]: LOGIN_COOKIE_VALUE });
    expect(hasActiveLoginSession(cookies)).toBe(true);
    expect(isRememberedLogin(cookies)).toBe(true);
    expect(REMEMBER_LOGIN_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it("does not accept arbitrary cookie values", () => {
    const cookies = cookieReader({ [LOGIN_SESSION_COOKIE]: "yes", [REMEMBER_LOGIN_COOKIE]: "true" });
    expect(hasActiveLoginSession(cookies)).toBe(false);
    expect(isRememberedLogin(cookies)).toBe(false);
  });
});
