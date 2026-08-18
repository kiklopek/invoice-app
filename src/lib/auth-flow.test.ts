import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("authentication flow", () => {
  it("checks the company invitation before creating an account", () => {
    const register = source("src/app/register/page.tsx");
    const accessRoute = source("src/app/api/auth/registration-access/route.ts");

    expect(register).toContain('fetch("/api/auth/registration-access"');
    expect(register.indexOf('fetch("/api/auth/registration-access"')).toBeLessThan(
      register.indexOf("supabase.auth.signUp")
    );
    expect(register).toContain("nebyl administrátorem firmy přidán do systému");
    expect(accessRoute).toContain('.from("organization_members")');
    expect(accessRoute).toContain('.eq("email", email)');
    expect(accessRoute).toContain("isSameOriginMutation(request)");
  });

  it("keeps password login behind organization membership verification", () => {
    expect(source("src/app/login/page.tsx")).toContain('fetch("/api/auth/access", { method: "POST" })');
    expect(source("src/app/api/auth/access/route.ts")).toContain("getRequestIdentity({ requireMfa: false })");
  });

  it("confirms role changes and removals from the membership table", () => {
    const membersRoute = source("src/app/api/settings/members/route.ts");
    expect(membersRoute).toContain('console.error("Member role confirmation failed"');
    expect(membersRoute).toContain('console.error("Member removal confirmation failed"');
    expect(membersRoute).toContain('return NextResponse.json({ error: "Přístup zůstal aktivní. Zkuste odebrání znovu." }');
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
