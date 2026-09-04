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
import { REMEMBER_LOGIN_TTL_SECONDS } from "@/lib/login-session";
import { hasRememberedLogin } from "@/lib/login-session-server";

const DEFAULT_AUTH_FROM = "Splatno <prihlaseni@splatno.cz>";

type EmailMfaEnvironment = {
  AUTH_EMAIL_DELIVERY_ENABLED?: string;
  AUTH_EMAIL_FROM?: string;
  REMINDER_EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
};

type EmailMfaDeliveryError = Error & {
  code?: string;
  statusCode?: number;
};

export function getEmailMfaConfiguration(env?: EmailMfaEnvironment) {
  const environment = env ?? process.env;
  if (environment.AUTH_EMAIL_DELIVERY_ENABLED === "false") return null;
  const apiKey = environment.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    from: environment.AUTH_EMAIL_FROM?.trim() || environment.REMINDER_EMAIL_FROM?.trim() || DEFAULT_AUTH_FROM,
  };
}

function emailMfaDeliveryError(providerError?: unknown) {
  const value = providerError as {
    code?: unknown;
    name?: unknown;
    status?: unknown;
    statusCode?: unknown;
  } | undefined;
  const error = new Error("EMAIL_MFA_DELIVERY_FAILED") as EmailMfaDeliveryError;
  error.code = typeof value?.name === "string"
    ? value.name
    : typeof value?.code === "string" ? value.code : undefined;
  error.statusCode = typeof value?.statusCode === "number"
    ? value.statusCode
    : typeof value?.status === "number" ? value.status : undefined;
  return error;
}

export function requireEmailMfaSecret() {
  const secret = process.env.EMAIL_MFA_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Chybí bezpečný EMAIL_MFA_SECRET.");
  return secret;
}

export async function hasVerifiedEmailMfa(params: {
  email: string;
  emailConfirmedAt?: string | null;
  userId: string;
  sessionId: string;
}) {
  if (isEmailMfaBypassed(params.email, params.emailConfirmedAt)) return true;
  const token = (await cookies()).get(EMAIL_MFA_COOKIE)?.value;
  return verifyEmailMfaToken({
    token,
    userId: params.userId,
    sessionId: params.sessionId,
    secret: process.env.EMAIL_MFA_SECRET,
  });
}

export async function setVerifiedEmailMfaCookie(userId: string, sessionId: string) {
  const remembered = await hasRememberedLogin({ userId, sessionId });
  const ttlSeconds = remembered ? REMEMBER_LOGIN_TTL_SECONDS : EMAIL_MFA_SESSION_TTL_SECONDS;
  const token = createEmailMfaToken({ userId, sessionId, secret: requireEmailMfaSecret(), ttlSeconds });
  (await cookies()).set(EMAIL_MFA_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ttlSeconds,
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
  const configuration = getEmailMfaConfiguration();
  if (!configuration) throw new Error("EMAIL_MFA_NOT_CONFIGURED");

  const resend = new Resend(configuration.apiKey);
  let result: Awaited<ReturnType<typeof resend.emails.send>>;
  try {
    result = await resend.emails.send({
      from: configuration.from,
      to: params.email,
      subject: "Přihlašovací kód Splatno.cz",
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px"><h1 style="font-size:22px">Ověření přihlášení</h1><p>Pro dokončení přihlášení do aplikace Splatno.cz použijte tento kód:</p><p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:28px 0">${params.code}</p><p>Kód platí 10 minut a lze jej použít pouze jednou. Pokud jste se nepřihlašovali, tento e-mail ignorujte.</p></div>`,
      text: `Ověření přihlášení do Splatno.cz\n\nVáš kód: ${params.code}\n\nKód platí 10 minut a lze jej použít pouze jednou.`,
    }, { idempotencyKey: `email-mfa/${params.challengeId}` });
  } catch (error) {
    throw emailMfaDeliveryError(error);
  }
  const { data, error } = result;
  if (error || !data?.id) throw emailMfaDeliveryError(error);
  return data.id;
}
