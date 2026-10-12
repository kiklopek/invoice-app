import { describe, expect, it } from "vitest";
import {
  createEmailMfaToken,
  createTrustedDeviceToken,
  TRUSTED_DEVICE_TTL_SECONDS,
  verifyEmailMfaToken,
  verifyTrustedDeviceToken,
} from "./email-mfa-core";

const secret = "s".repeat(48);
const userId = "11111111-1111-4111-8111-111111111111";
const otherUser = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const now = Date.UTC(2026, 9, 12, 8, 0, 0);

// Důvěryhodné zařízení: po zadání kódu z e-mailu si prohlížeč 30 dní pamatuje,
// že tenhle uživatel tu kód už zadal, a další přihlášení heslem kód nechce.
// Kód znovu: po 30 dnech, na jiném zařízení a pro jiného uživatele.
describe("token důvěryhodného zařízení", () => {
  it("platí 30 dní pro stejného uživatele", () => {
    expect(TRUSTED_DEVICE_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
    const token = createTrustedDeviceToken({ userId, secret, now });
    expect(verifyTrustedDeviceToken({ token, userId, secret, now })).toBe(true);
    expect(verifyTrustedDeviceToken({ token, userId, secret, now: now + (TRUSTED_DEVICE_TTL_SECONDS - 60) * 1000 })).toBe(true);
  });

  it("po 30 dnech vyprší (kód je potřeba znovu)", () => {
    const token = createTrustedDeviceToken({ userId, secret, now });
    expect(verifyTrustedDeviceToken({ token, userId, secret, now: now + (TRUSTED_DEVICE_TTL_SECONDS + 1) * 1000 })).toBe(false);
  });

  it("neplatí pro jiného uživatele na stejném zařízení", () => {
    const token = createTrustedDeviceToken({ userId, secret, now });
    expect(verifyTrustedDeviceToken({ token, userId: otherUser, secret, now })).toBe(false);
  });

  it("pozměněný obsah nebo podpis neprojde", () => {
    const token = createTrustedDeviceToken({ userId, secret, now });
    const [encoded, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, typ: "device", sub: otherUser, exp: 9_999_999_999 }), "utf8").toString("base64url");
    expect(verifyTrustedDeviceToken({ token: `${forged}.${sig}`, userId: otherUser, secret, now })).toBe(false);
    expect(verifyTrustedDeviceToken({ token: `${encoded}.${sig.slice(0, -2)}xx`, userId, secret, now })).toBe(false);
    expect(verifyTrustedDeviceToken({ token: `${encoded}.${sig}.extra`, userId, secret, now })).toBe(false);
    expect(verifyTrustedDeviceToken({ token: "nesmysl", userId, secret, now })).toBe(false);
  });

  it("jiný secret neprojde", () => {
    const token = createTrustedDeviceToken({ userId, secret, now });
    expect(verifyTrustedDeviceToken({ token, userId, secret: "t".repeat(48), now })).toBe(false);
  });

  it("bez tokenu nebo s krátkým secretem vždy false", () => {
    expect(verifyTrustedDeviceToken({ token: undefined, userId, secret, now })).toBe(false);
    expect(verifyTrustedDeviceToken({ token: null, userId, secret, now })).toBe(false);
    const token = createTrustedDeviceToken({ userId, secret, now });
    expect(verifyTrustedDeviceToken({ token, userId, secret: "kratky", now })).toBe(false);
    expect(verifyTrustedDeviceToken({ token, userId, secret: undefined, now })).toBe(false);
  });

  it("MFA token nejde použít jako token zařízení a naopak (oddělený podpis)", () => {
    const mfaToken = createEmailMfaToken({ userId, sessionId, secret, now });
    expect(verifyTrustedDeviceToken({ token: mfaToken, userId, secret, now })).toBe(false);
    const deviceToken = createTrustedDeviceToken({ userId, secret, now });
    expect(verifyEmailMfaToken({ token: deviceToken, userId, sessionId, secret, now })).toBe(false);
  });
});
