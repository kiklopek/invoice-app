import { afterEach, describe, expect, it, vi } from "vitest";
import { assertLocalEmailRecipientsAllowed, LocalEmailRecipientBlockedError } from "@/lib/local-email-allowlist";

describe("local email recipient allowlist", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows only configured recipients during development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_EMAIL_RECIPIENT_ALLOWLIST", "test-admin@hlavica.cz, finance@hlavica.cz");
    expect(() => assertLocalEmailRecipientsAllowed(["TEST-ADMIN@HLAVICA.CZ"])).not.toThrow();
    expect(() => assertLocalEmailRecipientsAllowed(["client@example.com"])).toThrow(LocalEmailRecipientBlockedError);
  });

  it("also protects cc recipients", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("LOCAL_EMAIL_RECIPIENT_ALLOWLIST", "test-admin@hlavica.cz");
    expect(() => assertLocalEmailRecipientsAllowed(["test-admin@hlavica.cz", "client@example.com"])).toThrow("LOCAL_EMAIL_RECIPIENT_BLOCKED");
  });

  it("does not alter production behavior", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_EMAIL_RECIPIENT_ALLOWLIST", "test-admin@hlavica.cz");
    expect(() => assertLocalEmailRecipientsAllowed(["client@example.com"])).not.toThrow();
  });
});
