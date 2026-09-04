import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { hashEmailMfaCode, isEmailMfaBypassed } from "@/lib/email-mfa-core";
import { requireEmailMfaSecret, setVerifiedEmailMfaCookie } from "@/lib/email-mfa-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { apiError } from "@/lib/api-response";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  }

  const identity = await getRequestIdentity({ requireMfa: false });
  if (!identity) return apiError(request, "Nejste přihlášený uživatel.", 401, "unauthorized");

  if (isEmailMfaBypassed(identity.membership.email)) {
    return NextResponse.json({ verified: true, bypassed: true });
  }

  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!/^\d{6}$/.test(code)) {
    return apiError(request, "Zadejte platný šestimístný kód.", 400, "invalid_code");
  }

  const { data: challenge, error: challengeError } = await identity.service
    .from("email_mfa_challenges")
    .select("id")
    .eq("user_id", identity.user.id)
    .eq("session_id", identity.sessionId)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (challengeError || !challenge) {
    return apiError(request, "Kód není aktivní. Nechte si poslat nový.", 400, "challenge_missing");
  }

  let secret: string;
  try {
    secret = requireEmailMfaSecret();
  } catch {
    return apiError(request, "E-mailové ověření není nakonfigurované.", 503, "mfa_unavailable");
  }
  const candidateHash = hashEmailMfaCode({
    challengeId: challenge.id,
    userId: identity.user.id,
    sessionId: identity.sessionId,
    code,
    secret,
  });
  const { data: status, error: verifyError } = await identity.service.rpc("verify_email_mfa_challenge", {
    target_challenge: challenge.id,
    target_user: identity.user.id,
    target_session: identity.sessionId,
    candidate_hash: candidateHash,
  });
  if (verifyError) return apiError(request, "Kód se nepodařilo ověřit.", 500, "mfa_verification_failed");
  if (status !== "verified") {
    const expired = status === "expired" || status === "locked" || status === "not_found";
    return apiError(request,
      expired ? "Kód vypršel nebo byl zablokován. Nechte si poslat nový." : "Kód není správný.",
      400,
      expired ? "challenge_expired" : "invalid_code",
    );
  }

  await setVerifiedEmailMfaCookie(identity.user.id, identity.sessionId);
  return NextResponse.json({ verified: true });
}
