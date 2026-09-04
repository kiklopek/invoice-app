import { randomInt, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import {
  EMAIL_MFA_CODE_TTL_SECONDS,
  hashEmailMfaCode,
  isEmailMfaBypassed,
  maskEmail,
} from "@/lib/email-mfa-core";
import {
  getEmailMfaConfiguration,
  requireEmailMfaSecret,
  sendEmailMfaCode,
} from "@/lib/email-mfa-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { apiError } from "@/lib/api-response";
import { logError, logInfo, requestId } from "@/lib/structured-log";

const RESEND_COOLDOWN_SECONDS = 60;

function providerContext(error: unknown) {
  const value = error as { code?: unknown; statusCode?: unknown };
  return {
    provider_code: typeof value?.code === "string" ? value.code : undefined,
    provider_status: typeof value?.statusCode === "number" ? value.statusCode : undefined,
  };
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  }

  const identity = await getRequestIdentity({ requireMfa: false });
  if (!identity) return apiError(request, "Nejste přihlášený uživatel.", 401, "unauthorized");

  const email = identity.membership.email;
  if (isEmailMfaBypassed(email, identity.user.email_confirmed_at)) {
    return NextResponse.json({ verified: true, bypassed: true });
  }

  let secret: string;
  try {
    secret = requireEmailMfaSecret();
  } catch (error) {
    logError("Email MFA configuration missing", error, { request_id: requestId(request) });
    return apiError(request, "E-mailové ověření není nakonfigurované.", 503, "mfa_unavailable");
  }
  if (!getEmailMfaConfiguration()) {
    logError("Email MFA delivery configuration missing", new Error("EMAIL_MFA_NOT_CONFIGURED"), {
      request_id: requestId(request),
    });
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
    logError("Email MFA challenge creation failed", challengeError, { request_id: requestId(request) });
    return apiError(request, "Ověřovací kód se nepodařilo připravit.", 500, "mfa_challenge_failed");
  }
  if (status === "rate_limited") {
    const { data: latestChallenge, error: latestChallengeError } = await identity.service
      .from("email_mfa_challenges")
      .select("created_at, consumed_at, expires_at")
      .eq("user_id", identity.user.id)
      .eq("session_id", identity.sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestChallengeError) {
      logError("Email MFA rate-limit state lookup failed", latestChallengeError, { request_id: requestId(request) });
    }
    const createdAt = latestChallenge ? Date.parse(latestChallenge.created_at) : Number.NaN;
    const retryAfter = Number.isFinite(createdAt)
      ? Math.max(1, RESEND_COOLDOWN_SECONDS - Math.floor((Date.now() - createdAt) / 1000))
      : RESEND_COOLDOWN_SECONDS;
    const canVerify = Boolean(latestChallenge &&
      !latestChallenge.consumed_at &&
      Date.parse(latestChallenge.expires_at) > Date.now());
    return apiError(
      request,
      "Nový kód lze odeslat nejdříve za jednu minutu.",
      429,
      "rate_limited",
      { retry_after: retryAfter, can_verify: canVerify, email: maskEmail(email) },
    );
  }
  if (status !== "created") {
    const error = new Error("EMAIL_MFA_CHALLENGE_INVALID_STATUS");
    logError("Email MFA challenge returned an invalid status", error, { request_id: requestId(request) });
    return apiError(request, "Ověřovací kód se nepodařilo připravit.", 500, "mfa_challenge_failed");
  }

  try {
    await sendEmailMfaCode({ email, code, challengeId });
    logInfo("Email MFA challenge delivered to provider", { request_id: requestId(request) });
  } catch (error) {
    logError("Email MFA delivery failed", error, {
      request_id: requestId(request),
      ...providerContext(error),
    });
    const { error: cleanupError } = await identity.service
      .from("email_mfa_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", challengeId);
    if (cleanupError) {
      logError("Email MFA failed challenge cleanup failed", cleanupError, { request_id: requestId(request) });
    }
    return apiError(
      request,
      "Kód se nepodařilo odeslat. Zkuste to znovu za jednu minutu.",
      503,
      "mfa_delivery_failed",
      { retry_after: RESEND_COOLDOWN_SECONDS },
    );
  }

  return NextResponse.json({ sent: true, email: maskEmail(email), expires_in: EMAIL_MFA_CODE_TTL_SECONDS });
}
