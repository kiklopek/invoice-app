import { NextResponse } from "next/server";
import { isAllowedCorporateEmail, normalizeEmail } from "@/lib/auth-policy";
import { getPasswordRecoveryBaseUrl, getPasswordRecoveryConfiguration, logPasswordRecoveryError, sendPasswordRecoveryEmail } from "@/lib/password-recovery-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { createServiceClient } from "@/lib/supabase-server";

const neutralResponse = () => NextResponse.json({ sent: true });

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });

  let body: { email?: unknown };
  try {
    body = (await request.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }

  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  if (!isAllowedCorporateEmail(email)) return NextResponse.json({ error: "Neplatná e-mailová adresa." }, { status: 400 });

  if (!getPasswordRecoveryConfiguration()) {
    logPasswordRecoveryError("Password recovery configuration missing", new Error("EMAIL_NOT_CONFIGURED"));
    return NextResponse.json({ error: "Odesílání e-mailů není momentálně dostupné." }, { status: 503 });
  }

  const service = createServiceClient();
  const { data: membership, error: membershipError } = await service.from("organization_members").select("user_id").eq("email", email).maybeSingle();
  if (membershipError) {
    logPasswordRecoveryError("Password recovery membership lookup failed", membershipError);
    return NextResponse.json({ error: "Odeslání se momentálně nepodařilo." }, { status: 503 });
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
