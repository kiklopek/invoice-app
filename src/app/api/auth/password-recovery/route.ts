import { NextResponse } from "next/server";
import { isAllowedCorporateEmail, normalizeEmail } from "@/lib/auth-policy";
import { getPasswordRecoveryBaseUrl, getPasswordRecoveryConfiguration, logPasswordRecoveryError, sendPasswordRecoveryEmail } from "@/lib/password-recovery-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { createServiceClient } from "@/lib/supabase-server";
import { apiError } from "@/lib/api-response";
import { consumePublicAuthLimit } from "@/lib/auth-rate-limit";
import { logError, requestId } from "@/lib/structured-log";

const neutralResponse = () => NextResponse.json({ sent: true });

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");

  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return apiError(request, "Neplatný požadavek.", 400, "invalid_request");
  }

  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  if (!isAllowedCorporateEmail(email)) return apiError(request, "Neplatná e-mailová adresa.", 400, "invalid_email");

  try {
    if (!await consumePublicAuthLimit(request, "password_recovery", email)) return neutralResponse();
  } catch (error) {
    logError("Password recovery rate limit failed", error, { request_id: requestId(request) });
    return apiError(request, "Odesílání se momentálně nepodařilo.", 503, "rate_limit_unavailable");
  }

  if (!getPasswordRecoveryConfiguration()) {
    logPasswordRecoveryError("Password recovery configuration missing", new Error("EMAIL_NOT_CONFIGURED"));
    return apiError(request, "Odesílání e-mailů není momentálně dostupné.", 503, "email_unavailable");
  }

  const service = createServiceClient();
  const { data: membership, error: membershipError } = await service.from("organization_members").select("user_id").eq("email", email).maybeSingle();
  if (membershipError) {
    logPasswordRecoveryError("Password recovery membership lookup failed", membershipError);
    return apiError(request, "Odeslání se momentálně nepodařilo.", 503, "membership_lookup_failed");
  }
  if (!membership?.user_id) return neutralResponse();

  const { data: userData, error: userError } = await service.auth.admin.getUserById(membership.user_id);
  if (userError || !userData.user || normalizeEmail(userData.user.email) !== email) {
    if (userError) logPasswordRecoveryError("Password recovery user lookup failed", userError);
    return neutralResponse();
  }

  const recoverySentAt = userData.user.recovery_sent_at ? new Date(userData.user.recovery_sent_at).getTime() : 0;
  if (recoverySentAt && Date.now() - recoverySentAt < 60_000) return neutralResponse();

  const recoveryDestination = new URL("/reset-password", getPasswordRecoveryBaseUrl()).toString();
  const { data: linkData, error: linkError } = await service.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: recoveryDestination } });
  if (linkError || !linkData.properties.hashed_token) {
    logPasswordRecoveryError("Password recovery link generation failed", linkError);
    return neutralResponse();
  }

  const recoveryUrl = new URL("/auth/recovery", getPasswordRecoveryBaseUrl());
  recoveryUrl.searchParams.set("token_hash", linkData.properties.hashed_token);
  try {
    await sendPasswordRecoveryEmail({ email, recoveryUrl: recoveryUrl.toString(), userId: userData.user.id });
  } catch (error) {
    logPasswordRecoveryError("Password recovery email delivery failed", error);
  }
  return neutralResponse();
}
