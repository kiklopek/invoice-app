import { afterEach, describe, expect, it, vi } from "vitest";
import { emailMatchesDomain, CUSTOM_ENTRY_EMAIL_DOMAIN, isDisposableEmail, isValidEmail, normalizeEmail } from "./auth-policy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth email policy", () => {
  it("accepts any valid address, also in production -- the domain is a per-company rule", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(isValidEmail(" tester@example.com ")).toBe(true);
    expect(isValidEmail("ucetni@hlavica.cz")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a@.cz")).toBe(false);
  });

  it("checks a company domain exactly, never as a suffix", () => {
    expect(emailMatchesDomain("ucetni@hlavica.cz", CUSTOM_ENTRY_EMAIL_DOMAIN)).toBe(true);
    expect(emailMatchesDomain(" UCETNI@HLAVICA.CZ ", CUSTOM_ENTRY_EMAIL_DOMAIN)).toBe(true);
    expect(emailMatchesDomain("x@evilhlavica.cz", CUSTOM_ENTRY_EMAIL_DOMAIN)).toBe(false);
    expect(emailMatchesDomain("x@hlavica.cz.evil.example", CUSTOM_ENTRY_EMAIL_DOMAIN)).toBe(false);
    expect(emailMatchesDomain("x@example.com", null)).toBe(true);
  });

  it("normalizes e-mails", () => {
    expect(normalizeEmail("  Jan@Firma.CZ ")).toBe("jan@firma.cz");
    expect(normalizeEmail(null)).toBe("");
  });

  it("recognises throwaway mailboxes used to farm free trials, including subdomains", () => {
    expect(isDisposableEmail("x@mailinator.com")).toBe(true);
    expect(isDisposableEmail(" X@Guerrillamail.COM ")).toBe(true);
    expect(isDisposableEmail("x@inbox.10minutemail.com")).toBe(true);
    expect(isDisposableEmail("jan@firma.cz")).toBe(false);
    expect(isDisposableEmail("jan@gmail.com")).toBe(false);
    expect(isDisposableEmail("jan@notmailinator.com")).toBe(false);
  });
});
