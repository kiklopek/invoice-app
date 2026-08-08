import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("authentication flow", () => {
  it("keeps password login behind organization membership verification", () => {
    expect(source("src/app/login/page.tsx")).toContain('fetch("/api/auth/access", { method: "POST" })');
    expect(source("src/app/api/auth/access/route.ts")).toContain("getRequestIdentity({ requireMfa: false })");
  });

  it("sends password logins through the email verification step", () => {
    expect(source("src/app/login/page.tsx")).toContain('window.location.assign("/mfa")');
    expect(source("src/app/mfa/page.tsx")).toContain('fetch("/api/auth/email-mfa/send"');
    expect(source("src/app/mfa/page.tsx")).toContain('fetch("/api/auth/email-mfa/verify"');
  });

  it("only accepts the password reset destination in the auth callback", () => {
    const callback = source("src/app/auth/callback/route.ts");
    expect(callback).toContain('requestedNext === "/reset-password"');
    expect(callback).toContain('const next =');
  });

  it("clears the email MFA session during logout", () => {
    expect(source("src/app/api/auth/logout/route.ts")).toContain("clearEmailMfaCookie");
  });
});
