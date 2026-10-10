import { afterEach, describe, expect, it, vi } from "vitest";
import { isBlockedReminderRecipient } from "./reminder-recipient-policy";
import { isIssuerReminderAddress } from "./reminder-recipient-safety";

afterEach(() => vi.unstubAllEnvs());
const issuer = { email: "info@hlavica.cz" };

describe("explicit testing recipients", () => {
  it("requires an explicit server setting", () => {
    for (const value of [undefined, "", " , "]) {
      vi.stubEnv("REMINDER_TEST_RECIPIENTS", value);
      expect(isBlockedReminderRecipient("adam@hlavica.cz", issuer)).toBe(true);
    }
  });

  it("allows exactly the listed addresses, normalizes input, and leaves OCR strict", () => {
    vi.stubEnv("REMINDER_TEST_RECIPIENTS", "adam@hlavica.cz, tester@example.cz");
    expect(isBlockedReminderRecipient(" ADAM@HLAVICA.CZ ", issuer)).toBe(false);
    expect(isIssuerReminderAddress("adam@hlavica.cz", issuer)).toBe(true);
    for (const address of ["info@hlavica.cz", "kostihova@hlavica.cz", "adam@mail.hlavica.cz", "other@hlavica.cz"]) {
      expect(isBlockedReminderRecipient(address, issuer)).toBe(true);
    }
    expect(isBlockedReminderRecipient("customer@example.cz", issuer)).toBe(false);
  });

  // Testovací výjimka nesmí v produkci měnit pravidla adresátů žádné firmě.
  it("is ignored in production", () => {
    vi.stubEnv("REMINDER_TEST_RECIPIENTS", "adam@hlavica.cz");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isBlockedReminderRecipient("adam@hlavica.cz", issuer)).toBe(true);
  });

  it("no longer reads the old per-person flag", () => {
    vi.stubEnv("ALLOW_ADAM_REMINDER_TEST_EMAIL", "true");
    expect(isBlockedReminderRecipient("adam@hlavica.cz", issuer)).toBe(true);
  });
});
