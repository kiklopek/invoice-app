import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resendSend } = vi.hoisted(() => ({ resendSend: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/login-session-server", () => ({ hasRememberedLogin: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

import { getEmailMfaConfiguration, sendEmailMfaCode } from "./email-mfa-server";

describe("email MFA delivery", () => {
  beforeEach(() => {
    resendSend.mockReset();
    vi.stubEnv("AUTH_EMAIL_DELIVERY_ENABLED", "true");
    vi.stubEnv("AUTH_EMAIL_FROM", "Splatno <prihlaseni@splatno.cz>");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("requires enabled delivery and a Resend API key", () => {
    expect(getEmailMfaConfiguration({ AUTH_EMAIL_DELIVERY_ENABLED: "false", RESEND_API_KEY: "re_key" })).toBeNull();
    expect(getEmailMfaConfiguration({ AUTH_EMAIL_DELIVERY_ENABLED: "true" })).toBeNull();
  });

  it("uses the dedicated authentication sender with a safe default", () => {
    expect(getEmailMfaConfiguration({ RESEND_API_KEY: " re_key " })).toEqual({
      apiKey: "re_key",
      from: "Splatno <prihlaseni@splatno.cz>",
    });
  });

  it("sends one idempotent six-digit login code", async () => {
    resendSend.mockResolvedValue({ data: { id: "provider-message-id" }, error: null });

    await expect(sendEmailMfaCode({
      email: "user@hlavica.cz",
      code: "123456",
      challengeId: "11111111-1111-4111-8111-111111111111",
    })).resolves.toBe("provider-message-id");

    expect(resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Splatno <prihlaseni@splatno.cz>",
        to: "user@hlavica.cz",
        subject: "Přihlašovací kód Splatno.cz",
        text: expect.stringContaining("123456"),
      }),
      { idempotencyKey: "email-mfa/11111111-1111-4111-8111-111111111111" },
    );
  });

  it("preserves only the safe Resend error code and status", async () => {
    resendSend.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "recipient-sensitive detail", statusCode: 403 },
    });

    await expect(sendEmailMfaCode({
      email: "user@hlavica.cz",
      code: "123456",
      challengeId: "11111111-1111-4111-8111-111111111111",
    })).rejects.toMatchObject({
      message: "EMAIL_MFA_DELIVERY_FAILED",
      code: "validation_error",
      statusCode: 403,
    });
  });
});
