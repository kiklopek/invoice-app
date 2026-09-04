import "server-only";

import { Resend } from "resend";

const DEFAULT_APP_URL = "https://www.splatno.cz";
const DEFAULT_AUTH_FROM = "Splatno <prihlaseni@mail.splatno.cz>";

export function getPasswordRecoveryBaseUrl() {
  const configured = process.env.APP_BASE_URL?.trim();
  if (!configured) return DEFAULT_APP_URL;

  try {
    const url = new URL(configured);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return DEFAULT_APP_URL;
    return url.origin;
  } catch {
    return DEFAULT_APP_URL;
  }
}

export function getPasswordRecoveryConfiguration() {
  if (process.env.AUTH_EMAIL_DELIVERY_ENABLED === "false") return null;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, from: process.env.AUTH_EMAIL_FROM?.trim() || DEFAULT_AUTH_FROM };
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function sendPasswordRecoveryEmail(params: { email: string; recoveryUrl: string; userId: string }) {
  const configuration = getPasswordRecoveryConfiguration();
  if (!configuration) throw new Error("PASSWORD_RECOVERY_EMAIL_NOT_CONFIGURED");

  const resend = new Resend(configuration.apiKey);
  const safeUrl = escapeHtml(params.recoveryUrl);
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const { error } = await resend.emails.send({
    from: configuration.from,
    to: params.email,
    subject: "Obnovení hesla Splatno.cz",
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#17251d"><h1 style="font-size:24px">Obnovení hesla</h1><p>Obdrželi jsme žádost o nastavení nového hesla do aplikace Splatno.cz.</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#236044;color:#fff;text-decoration:none;padding:13px 20px;border-radius:8px;font-weight:700">Nastavit nové heslo</a></p><p>Odkaz je jednorázový. Pokud jste o změnu hesla nežádali, tento e-mail ignorujte.</p></div>`,
    text: `Obnovení hesla Splatno.cz\n\nNové heslo nastavíte pomocí tohoto jednorázového odkazu:\n${params.recoveryUrl}\n\nPokud jste o změnu hesla nežádali, tento e-mail ignorujte.`,
  }, { idempotencyKey: `password-recovery/${params.userId}/${minuteBucket}` });

  if (error) {
    const resendError = new Error("PASSWORD_RECOVERY_EMAIL_FAILED") as Error & { code?: string; statusCode?: number };
    resendError.code = error.name;
    resendError.statusCode = "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : undefined;
    throw resendError;
  }
}

export function logPasswordRecoveryError(operation: string, error: unknown) {
  const safeError = error as { code?: unknown; status?: unknown; statusCode?: unknown; name?: unknown };
  console.error(operation, {
    code: typeof safeError?.code === "string" ? safeError.code : undefined,
    status: typeof safeError?.status === "number" ? safeError.status : typeof safeError?.statusCode === "number" ? safeError.statusCode : undefined,
    type: typeof safeError?.name === "string" ? safeError.name : undefined,
  });
}
