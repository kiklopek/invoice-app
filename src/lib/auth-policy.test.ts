import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedCorporateEmail, isCorporateEmailRequired } from "./auth-policy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth email policy", () => {
  it("allows a valid non-corporate address outside production", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(isCorporateEmailRequired()).toBe(false);
    expect(isAllowedCorporateEmail(" tester@example.com ")).toBe(true);
    expect(isAllowedCorporateEmail("not-an-email")).toBe(false);
  });

  it("only allows @hlavica.cz addresses in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(isCorporateEmailRequired()).toBe(true);
    expect(isAllowedCorporateEmail("ucetni@hlavica.cz")).toBe(true);
    expect(isAllowedCorporateEmail("tester@example.com")).toBe(false);
  });
});
