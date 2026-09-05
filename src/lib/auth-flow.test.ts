import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("authentication flow", () => {
  it("checks the company invitation before creating an account", () => {
    const register = source("src/app/(auth)/register/page.tsx");
    const accessRoute = source("src/app/api/auth/registration-access/route.ts");

    expect(register).toContain('fetch("/api/auth/registration-access"');
    expect(register.indexOf('fetch("/api/auth/registration-access"')).toBeLessThan(
      register.indexOf("supabase.auth.signUp")
    );
    expect(register).toContain("nebyl administrátorem firmy přidán do systému");
    expect(accessRoute).toContain('.from("organization_members")');
    expect(accessRoute).toContain('.eq("email", email)');
    expect(accessRoute).toContain("isSameOriginMutation(request)");
    expect(accessRoute).toContain("consumePublicAuthLimit");
  });

  it("deletes removed users and requires a fresh verified registration", () => {
    const register = source("src/app/(auth)/register/page.tsx");
    const settings = source("src/app/(workspace)/settings/page.tsx");
    const membersRoute = source("src/app/api/settings/members/route.ts");

    expect(register).toContain("Potvrďte svůj e-mail");
    expect(register).toContain("data.user.identities.length === 0");
    expect(register).not.toContain("auth-account-guidance");
    expect(register).not.toContain("Účet nevytvářejte znovu");
    expect(settings).toContain("Přihlašovací účet bude smazán");
    expect(settings).toContain("projít novou registrací a ověřit e-mail");
    expect(membersRoute).toContain("identity.service.auth.admin.deleteUser(mutation.auth_user_id, false)");
    expect(membersRoute).toContain('rpc("restore_organization_member_after_auth_delete_failure"');
  });

  it("keeps password login behind organization membership verification", () => {
    expect(source("src/app/(auth)/login/page.tsx")).toContain('fetch("/api/auth/access", { method: "POST" })');
    expect(source("src/app/api/auth/access/route.ts")).toContain("getRequestIdentity({ requireMfa: false, requireLoginSession: false })");
  });

  it("confirms role changes and removals from the membership table", () => {
    const membersRoute = source("src/app/api/settings/members/route.ts");
    expect(membersRoute).toContain('console.error("Member role confirmation failed"');
    expect(membersRoute).toContain('console.error("Member removal confirmation failed"');
    expect(membersRoute).toContain('console.error("Auth user deletion failed"');
    expect(membersRoute).toContain('return NextResponse.json({ error: "Přístup zůstal aktivní. Zkuste odebrání znovu." }');
  });

  it("sends ordinary password logins through e-mail verification while the trusted account opens the dashboard", () => {
    const login = source("src/app/(auth)/login/page.tsx");
    const accessRoute = source("src/app/api/auth/access/route.ts");
    expect(login).toContain('window.location.assign(access.mfaBypassed ? "/dashboard" : "/mfa")');
    expect(login).toContain('fetch("/api/auth/session-preference"');
    expect(login).toContain("Zapamatovat si mě na 30 dní");
    expect(accessRoute).toContain("mfa_bypassed");
    expect(source("src/proxy.ts")).toContain("isEmailMfaBypassed(email, user.email_confirmed_at)");
    expect(source("src/app/auth/callback/route.ts")).toContain("emailConfirmedAt: identity.user.email_confirmed_at");
    expect(source("src/app/(auth)/register/page.tsx")).toContain('access?.mfa_bypassed === true ? "/dashboard" : "/mfa"');
    expect(source("src/lib/email-mfa-core.ts")).not.toContain("EMAIL_MFA_BYPASS_EMAILS");
    expect(source("src/app/(auth)/mfa/page.tsx")).toContain('fetch("/api/auth/email-mfa/send"');
    expect(source("src/app/(auth)/mfa/page.tsx")).toContain('fetch("/api/auth/email-mfa/verify"');
    expect(source("src/app/(auth)/mfa/page.tsx")).toContain("codeAvailable");
    expect(source("src/app/api/auth/email-mfa/send/route.ts")).toContain('logError("Email MFA delivery failed"');
    expect(source("src/app/api/auth/email-mfa/verify/route.ts")).toContain('logError("Email MFA challenge verification failed"');
  });

  it("requires an explicit current or remembered login session", () => {
    const proxy = source("src/proxy.ts");
    const identity = source("src/lib/auth.ts");
    expect(proxy).toContain("hasActiveLoginSession(request.cookies, {");
    expect(proxy).toContain("sessionId,");
    expect(proxy).toContain('supabase.auth.signOut({ scope: "local" })');
    expect(identity).toContain("requireLoginSession = true");
  });

  it("only accepts the password reset destination in the auth callback", () => {
    const callback = source("src/app/auth/callback/route.ts");
    expect(callback).toContain('requestedNext === "/reset-password"');
    expect(callback).toContain('const next =');
  });

  it("uses one neutral login error with a working password recovery link", () => {
    const login = source("src/app/(auth)/login/page.tsx");
    expect(login).toContain("E-mail nebo heslo není správné. Zkuste to znovu nebo klikněte na");
    expect(login).toContain('<Link href="/forgot-password">„Obnovit heslo“</Link>');
    expect(login).toContain('<Link href="/forgot-password">Obnovit heslo</Link>');
    expect(login).not.toContain("Případně si nastavte nové heslo");
  });

  it("sends password recovery through the protected server endpoint", () => {
    const forgotPassword = source("src/app/(auth)/forgot-password/page.tsx");
    const recoveryRoute = source("src/app/api/auth/password-recovery/route.ts");
    const tokenRoute = source("src/app/auth/recovery/route.ts");
    const recoveryEmail = source("src/lib/password-recovery-server.ts");

    expect(forgotPassword).toContain('fetch("/api/auth/password-recovery"');
    expect(forgotPassword).not.toContain("resetPasswordForEmail");
    expect(forgotPassword).toContain('reason === "expired"');
    expect(forgotPassword).toContain('reason === "technical"');
    expect(recoveryRoute).toContain("isSameOriginMutation(request)");
    expect(recoveryRoute).toContain("consumePublicAuthLimit");
    expect(recoveryRoute).toContain("apiError(");
    expect(recoveryRoute).toContain('.from("organization_members")');
    expect(recoveryRoute).toContain("service.auth.admin.generateLink");
    expect(recoveryRoute).toContain("if (!membership?.user_id) return neutralResponse()");
    expect(recoveryEmail).toContain('process.env.RESEND_API_KEY');
    expect(recoveryEmail).toContain('process.env.AUTH_EMAIL_DELIVERY_ENABLED === "false"');
    expect(recoveryEmail).toContain('Splatno <prihlaseni@mail.splatno.cz>');
    expect(tokenRoute).toContain('type: "recovery"');
    expect(tokenRoute).toContain("supabase.auth.verifyOtp");
    expect(tokenRoute).toContain('.eq("user_id", data.user.id)');
    expect(tokenRoute).toContain('new URL("/reset-password", requestUrl.origin)');
  });

  it("keeps recovery logs free of e-mail addresses and recovery tokens", () => {
    const recoveryRoute = source("src/app/api/auth/password-recovery/route.ts");
    const recoveryEmail = source("src/lib/password-recovery-server.ts");
    expect(recoveryRoute).not.toContain("console.error");
    expect(recoveryEmail).toContain("logPasswordRecoveryError");
    expect(recoveryEmail).not.toContain("console.error(operation, error)");
  });

  it("clears the email MFA session during logout", () => {
    expect(source("src/app/api/auth/logout/route.ts")).toContain("clearEmailMfaCookie");
    expect(source("src/app/api/auth/logout/route.ts")).toContain("clearLoginSessionPreference");
  });
});
