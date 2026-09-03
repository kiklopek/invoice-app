import { createUserServerClient } from "@/lib/supabase-server";
import { getRequestIdentity } from "@/lib/auth";
import { isAllowedCorporateEmail } from "@/lib/auth-policy";
import { hasVerifiedEmailMfa } from "@/lib/email-mfa-server";
import { setLoginSessionPreference } from "@/lib/login-session-server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next");
  const next = requestedNext === "/reset-password" ? requestedNext : "/mfa";
  if (code) {
    const supabase = await createUserServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: userData } = await supabase.auth.getUser();
      if (!isAllowedCorporateEmail(userData.user?.email)) {
        await supabase.auth.signOut();
        return NextResponse.redirect(new URL("/login?error=domain", url.origin));
      }

      const identity = await getRequestIdentity({ requireMfa: false, requireLoginSession: false });
      if (!identity) {
        await supabase.auth.signOut();
        return NextResponse.redirect(new URL("/login?error=access", url.origin));
      }

      if (next === "/reset-password") {
        await setLoginSessionPreference(false);
        return NextResponse.redirect(new URL(next, url.origin));
      }

      await setLoginSessionPreference(false);
      const verified = await hasVerifiedEmailMfa({
        email: identity.membership.email,
        userId: identity.user.id,
        sessionId: identity.sessionId,
      });
      return NextResponse.redirect(
        new URL(verified ? "/dashboard" : "/mfa", url.origin)
      );
    }
  }
  return NextResponse.redirect(new URL("/login?error=callback", url.origin));
}
