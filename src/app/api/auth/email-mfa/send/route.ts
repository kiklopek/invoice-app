import { randomInt, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import {
  EMAIL_MFA_CODE_TTL_SECONDS,
  hashEmailMfaCode,
  isEmailMfaBypassed,
  maskEmail,
} from "@/lib/email-mfa-core";
import { requireEmailMfaSecret, sendEmailMfaCode } from "@/lib/email-mfa-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { apiError } from "@/lib/api-response";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  }

  const identity = await getRequestIdentity({ requireMfa: false });
  if (!identity) return apiError(request, "Nejste přihlášený uživatel.", 401, "unauthorized");

  const email = identity.membership.email;
  if (isEmailMfaBypassed(email)) {
    return NextResponse.json({ verified: true, bypassed: true });
  }

  let secret: string;
  try {
    secret = requireEmailMfaSecret();
  } catch {
    return apiError(request, "E-mailové ověření není nakonfigurované.", 503, "mfa_unavailable");
  }

  const challengeId = randomUUID();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const codeHash = hashEmailMfaCode({
    challengeId,
    userId: identity.user.id,
    sessionId: identity.sessionId,
    code,
    secret,
  });
  const expiresAt = new Date(Date.now() + EMAIL_MFA_CODE_TTL_SECONDS * 1000).toISOString();
  const { data: status, error: challengeError } = await identity.service.rpc("create_email_mfa_challenge", {
    target_challenge: challengeId,
    target_user: identity.user.id,
    target_session: identity.sessionId,
    target_code_hash: codeHash,
    target_expires_at: expiresAt,
  });

  if (challengeError) {
    return apiError(request, "Ověřovací kód se nepodařilo připravit.", 500, "mfa_challenge_failed");
  }
  if (status === "rate_limited") {
    return apiError(request, "Nový kód lze odeslat nejdříve za jednu minutu.", 429, "rate_limited");
  }

  try {
    await sendEmailMfaCode({ email, code, challengeId });
  } catch {
    await identity.service.from("email_mfa_challenges").update({ consumed_at: new Date().toISOString() }).eq("id", challengeId);
    return apiError(request, "Kód se nepodařilo odeslat. Zkontrolujte nastavení e-mailové služby.", 503, "mfa_delivery_failed");
  }

  return NextResponse.json({ sent: true, email: maskEmail(email), expires_in: EMAIL_MFA_CODE_TTL_SECONDS });
}
