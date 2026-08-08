import { describe, expect, it } from "vitest";
import {
  createEmailMfaToken,
  hashEmailMfaCode,
  isEmailMfaBypassed,
  maskEmail,
  sessionIdFromAccessToken,
  verifyEmailMfaToken,
} from "./email-mfa-core";

const secret = "a-secure-test-secret-with-more-than-32-characters";
const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

describe("email MFA", () => {
  it("binds its signed cookie to both user and Supabase session", () => {
    const token = createEmailMfaToken({ userId, sessionId, secret, now: 1_000_000 });
    expect(verifyEmailMfaToken({ token, userId, sessionId, secret, now: 1_001_000 })).toBe(true);
    expect(verifyEmailMfaToken({ token, userId, sessionId: userId, secret, now: 1_001_000 })).toBe(false);
    expect(verifyEmailMfaToken({ token, userId, sessionId, secret: `${secret}x`, now: 1_001_000 })).toBe(false);
    expect(verifyEmailMfaToken({ token, userId, sessionId, secret, now: 50_000_000 })).toBe(false);
  });

  it("hashes a code for one challenge, user and session only", () => {
    const first = hashEmailMfaCode({ challengeId: userId, userId, sessionId, code: "123456", secret });
    const second = hashEmailMfaCode({ challengeId: sessionId, userId, sessionId, code: "123456", secret });
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
  });

  it("requires an exact normalized email for a temporary bypass", () => {
    expect(isEmailMfaBypassed(" Test-Admin@Hlavica.cz ", "other@hlavica.cz, test-admin@hlavica.cz")).toBe(true);
    expect(isEmailMfaBypassed("admin@hlavica.cz", "test-admin@hlavica.cz")).toBe(false);
  });

  it("extracts the stable session id and masks email output", () => {
    const payload = Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url");
    expect(sessionIdFromAccessToken(`header.${payload}.signature`)).toBe(sessionId);
    expect(maskEmail("test-admin@hlavica.cz")).toBe("te********@hlavica.cz");
  });
});
