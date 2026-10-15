import "server-only";

import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import { getEmailMfaConfiguration } from "@/lib/email-mfa-server";
import { assertLocalEmailRecipientsAllowed } from "@/lib/local-email-allowlist";
import { renderAuthCodeEmail } from "@/lib/auth-code-email";
import { authCodeLogoAttachment } from "@/lib/auth-code-email-assets";
import { isVerificationCode } from "@/lib/verification-code";

export async function sendRegistrationCode(params: { email: string; code: string; locale: "cs" | "en" }) {
  assertLocalEmailRecipientsAllowed([params.email]);
  if (!isVerificationCode(params.code)) throw new Error("INVALID_REGISTRATION_CODE");
  const configuration = getEmailMfaConfiguration();
  if (!configuration) throw new Error("REGISTRATION_EMAIL_NOT_CONFIGURED");
  const rendered = renderAuthCodeEmail({ code: params.code, purpose: "registration", locale: params.locale, inlineLogo: true });
  const resend = new Resend(configuration.apiKey);
  const { data, error } = await resend.emails.send({
    from: configuration.from,
    to: params.email,
    ...rendered,
    attachments: [await authCodeLogoAttachment()],
  }, { idempotencyKey: `registration-code/${randomUUID()}` });
  if (error || !data?.id) {
    const safeError = new Error("REGISTRATION_EMAIL_DELIVERY_FAILED") as Error & { code?: string; statusCode?: number };
    safeError.code = error?.name;
    safeError.statusCode = error?.statusCode ?? undefined;
    throw safeError;
  }
}
