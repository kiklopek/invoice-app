import { afterEach, describe, expect, it, vi } from "vitest";
import { isBlockedReminderRecipient } from "./reminder-recipient-policy";
import { isIssuerReminderAddress } from "./reminder-recipient-safety";

afterEach(() => vi.unstubAllEnvs());
const issuer = { email: "info@hlavica.cz" };

describe("explicit testing recipient", () => {
  it("requires an explicit server setting", () => {
    for (const value of [undefined, "false", "1", "TRUE"]) {
      vi.stubEnv("ALLOW_ADAM_REMINDER_TEST_EMAIL", value);
      expect(isBlockedReminderRecipient("adam@hlavica.cz", issuer)).toBe(true);
    }
  });
  it("allows exactly Adam, normalizes input, and leaves OCR strict", () => {
    vi.stubEnv("ALLOW_ADAM_REMINDER_TEST_EMAIL", "true");
    expect(isBlockedReminderRecipient(" ADAM@HLAVICA.CZ ", issuer)).toBe(false);
    expect(isIssuerReminderAddress("adam@hlavica.cz", issuer)).toBe(true);
    for (const address of ["info@hlavica.cz", "kostihova@hlavica.cz", "adam@mail.hlavica.cz", "other@hlavica.cz"]) {
      expect(isBlockedReminderRecipient(address, issuer)).toBe(true);
    }
    expect(isBlockedReminderRecipient("customer@example.cz", issuer)).toBe(false);
  });
});
