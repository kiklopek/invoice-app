import { NextResponse } from "next/server";
import { isAllowedCorporateEmail, normalizeEmail } from "@/lib/auth-policy";
import { logPasswordRecoveryError } from "@/lib/password-recovery-server";
import { sessionIdFromAccessToken } from "@/lib/email-mfa-core";
import { setLoginSessionPreference } from "@/lib/login-session-server";
import { createServiceClient, createUserServerClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  if (!tokenHash) return NextResponse.redirect(new URL("/forgot-password?error=expired", requestUrl.origin));

  const supabase = await createUserServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
  if (error || !data.user?.id || !isAllowedCorporateEmail(data.user.email)) {
    if (error) logPasswordRecoveryError("Password recovery token verification failed", error);
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/forgot-password?error=expired", requestUrl.origin));
  }

  const email = normalizeEmail(data.user.email);
  const service = createServiceClient();
  const { data: membership, error: membershipError } = await service.from("organization_members").select("id").eq("user_id", data.user.id).eq("email", email).maybeSingle();
  if (membershipError) {
    logPasswordRecoveryError("Password recovery membership verification failed", membershipError);
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/forgot-password?error=technical", requestUrl.origin));
  }
  if (!membership) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=access", requestUrl.origin));
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const sessionId = sessionIdFromAccessToken(sessionData.session?.access_token);
  if (!sessionId) {
    await supabase.auth.signOut({ scope: "local" });
    return NextResponse.redirect(new URL("/forgot-password?error=technical", requestUrl.origin));
  }
  await setLoginSessionPreference(false, { userId: data.user.id, sessionId });
  return NextResponse.redirect(new URL("/reset-password", requestUrl.origin));
}
