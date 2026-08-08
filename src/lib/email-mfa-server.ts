import "server-only";

import { Resend } from "resend";
import { cookies } from "next/headers";
import {
  createEmailMfaToken,
  EMAIL_MFA_COOKIE,
  EMAIL_MFA_SESSION_TTL_SECONDS,
  isEmailMfaBypassed,
  verifyEmailMfaToken,
} from "@/lib/email-mfa-core";

export function requireEmailMfaSecret() {
  const secret = process.env.EMAIL_MFA_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Chybí bezpečný EMAIL_MFA_SECRET.");
  return secret;
}

export async function hasVerifiedEmailMfa(params: {
  email: string;
  userId: string;
  sessionId: string;
}) {
  if (isEmailMfaBypassed(params.email)) return true;
  const token = (await cookies()).get(EMAIL_MFA_COOKIE)?.value;
  return verifyEmailMfaToken({
    token,
    userId: params.userId,
    sessionId: params.sessionId,
    secret: process.env.EMAIL_MFA_SECRET,
  });
}

export async function setVerifiedEmailMfaCookie(userId: string, sessionId: string) {
  const token = createEmailMfaToken({ userId, sessionId, secret: requireEmailMfaSecret() });
  (await cookies()).set(EMAIL_MFA_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: EMAIL_MFA_SESSION_TTL_SECONDS,
    priority: "high",
  });
}

export async function clearEmailMfaCookie() {
  (await cookies()).set(EMAIL_MFA_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export async function sendEmailMfaCode(params: { email: string; code: string; challengeId: string }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.AUTH_EMAIL_FROM?.trim() || process.env.REMINDER_EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new Error("Odesílání přihlašovacích kódů není nakonfigurované.");

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: params.email,
    subject: "Přihlašovací kód Splatno.cz",
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px"><h1 style="font-size:22px">Ověření přihlášení</h1><p>Pro dokončení přihlášení do aplikace Splatno.cz použijte tento kód:</p><p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:28px 0">${params.code}</p><p>Kód platí 10 minut a lze jej použít pouze jednou. Pokud jste se nepřihlašovali, tento e-mail ignorujte.</p></div>`,
    text: `Ověření přihlášení do Splatno.cz\n\nVáš kód: ${params.code}\n\nKód platí 10 minut a lze jej použít pouze jednou.`,
  }, { idempotencyKey: `email-mfa/${params.challengeId}` });
  if (error) throw new Error("Přihlašovací kód se nepodařilo odeslat.");
}
