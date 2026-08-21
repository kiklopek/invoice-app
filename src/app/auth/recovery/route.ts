import { NextResponse } from "next/server";
import { isAllowedCorporateEmail, normalizeEmail } from "@/lib/auth-policy";
import { logPasswordRecoveryError } from "@/lib/password-recovery-server";
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
  return NextResponse.redirect(new URL("/reset-password", requestUrl.origin));
}
