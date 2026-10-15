import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn(), config: vi.fn(), allow: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: mocks.send }; } }));
vi.mock("@/lib/email-mfa-server", () => ({ getEmailMfaConfiguration: mocks.config }));
vi.mock("@/lib/local-email-allowlist", () => ({ assertLocalEmailRecipientsAllowed: mocks.allow }));
import { sendRegistrationCode } from "./registration-email-server";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({ apiKey: "test", from: "Splatno <test@example.org>" });
  mocks.send.mockResolvedValue({ data: { id: "email-a" }, error: null });
});
describe("registration code delivery", () => {
  it.each(["cs", "en"] as const)("delivers a code with no authentication link in %s", async locale => {
    await sendRegistrationCode({ email: "jana@example.org", code: "A7K9B", locale });
    const message = mocks.send.mock.calls[0][0];
    expect(message.to).toBe("jana@example.org");
    expect(message.text).toContain("A7K9B");
    expect(message.html).not.toContain("href=");
    expect(message.text).not.toMatch(/https?:/);
  });
  it("fails on provider rejection instead of reporting a sent code", async () => {
    mocks.send.mockResolvedValue({ data: null, error: { name: "rate_limit" } });
    await expect(sendRegistrationCode({ email: "jana@example.org", code: "A7K9B", locale: "cs" })).rejects.toThrow("REGISTRATION_EMAIL_DELIVERY_FAILED");
  });
  it("respects the local delivery allowlist before sending", async () => {
    mocks.allow.mockImplementation(() => { throw new Error("blocked"); });
    await expect(sendRegistrationCode({ email: "jana@example.org", code: "A7K9B", locale: "cs" })).rejects.toThrow("blocked");
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
