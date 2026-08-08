import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { hashEmailMfaCode, isEmailMfaBypassed } from "@/lib/email-mfa-core";
import { requireEmailMfaSecret, setVerifiedEmailMfaCookie } from "@/lib/email-mfa-server";
import { isSameOriginMutation } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  }

  const identity = await getRequestIdentity({ requireMfa: false });
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });

  if (isEmailMfaBypassed(identity.membership.email)) {
    return NextResponse.json({ verified: true, bypassed: true });
  }

  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Zadejte platný šestimístný kód." }, { status: 400 });
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
    return NextResponse.json({ error: "Kód není aktivní. Nechte si poslat nový." }, { status: 400 });
  }

  let secret: string;
  try {
    secret = requireEmailMfaSecret();
  } catch {
    return NextResponse.json({ error: "E-mailové ověření není nakonfigurované." }, { status: 503 });
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
  if (verifyError) return NextResponse.json({ error: "Kód se nepodařilo ověřit." }, { status: 500 });
  if (status !== "verified") {
    const expired = status === "expired" || status === "locked" || status === "not_found";
    return NextResponse.json({
      error: expired ? "Kód vypršel nebo byl zablokován. Nechte si poslat nový." : "Kód není správný.",
    }, { status: 400 });
  }

  await setVerifiedEmailMfaCookie(identity.user.id, identity.sessionId);
  return NextResponse.json({ verified: true });
}
