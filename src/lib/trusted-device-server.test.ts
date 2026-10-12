import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTrustedDeviceToken,
  EMAIL_MFA_COOKIE,
  TRUSTED_DEVICE_COOKIE,
  TRUSTED_DEVICE_TTL_SECONDS,
  verifyEmailMfaToken,
} from "./email-mfa-core";

const store = vi.hoisted(() => {
  const values = new Map<string, string>();
  const set = vi.fn((name: string, value: string, _options?: Record<string, unknown>) => { values.set(name, value); });
  return { values, set };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (store.values.has(name) ? { name, value: store.values.get(name) } : undefined),
    set: store.set,
  }),
}));
vi.mock("@/lib/login-session-server", () => ({ hasRememberedLogin: async () => false }));
vi.mock("resend", () => ({ Resend: class {} }));

import { setTrustedDeviceCookie, trustDeviceSession } from "./email-mfa-server";

const secret = "s".repeat(48);
const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  store.values.clear();
  store.set.mockClear();
  vi.stubEnv("EMAIL_MFA_SECRET", secret);
});

describe("důvěryhodné zařízení na serveru", () => {
  it("po zadání kódu uloží cookie zařízení na 30 dní (httpOnly, strict)", async () => {
    await setTrustedDeviceCookie(userId);
    const [name, value, options] = store.set.mock.calls[0];
    expect(name).toBe(TRUSTED_DEVICE_COOKIE);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/", maxAge: TRUSTED_DEVICE_TTL_SECONDS });
    expect(value.split(".")).toHaveLength(2);
  });

  it("platné zařízení ověří novou session bez kódu (nastaví MFA cookie)", async () => {
    store.values.set(TRUSTED_DEVICE_COOKIE, createTrustedDeviceToken({ userId, secret }));
    expect(await trustDeviceSession({ userId, sessionId })).toBe(true);
    const mfa = store.set.mock.calls.find(([name]) => name === EMAIL_MFA_COOKIE);
    expect(mfa).toBeTruthy();
    expect(verifyEmailMfaToken({ token: mfa![1], userId, sessionId, secret })).toBe(true);
  });

  it("bez cookie nebo s cookie jiného uživatele kód chce (nic nenastaví)", async () => {
    expect(await trustDeviceSession({ userId, sessionId })).toBe(false);
    store.values.set(TRUSTED_DEVICE_COOKIE, createTrustedDeviceToken({ userId: "22222222-2222-4222-8222-222222222222", secret }));
    expect(await trustDeviceSession({ userId, sessionId })).toBe(false);
    expect(store.set).not.toHaveBeenCalled();
  });

  it("prošlá cookie (po 30 dnech) kód chce", async () => {
    const issued = Date.now() - (TRUSTED_DEVICE_TTL_SECONDS + 60) * 1000;
    store.values.set(TRUSTED_DEVICE_COOKIE, createTrustedDeviceToken({ userId, secret, now: issued }));
    expect(await trustDeviceSession({ userId, sessionId })).toBe(false);
  });
});
