import { createUserServerClient } from "@/lib/supabase-server";
import { getAuthenticatedSession, resolveMembership } from "@/lib/auth";
import { hasVerifiedEmailMfa } from "@/lib/email-mfa-server";
import { setLoginSessionPreference } from "@/lib/login-session-server";
import { NextResponse } from "next/server";

// Odkaz z potvrzovacího e-mailu registrace (a obnovy hesla). Pozvaný člověk
// se tu rovnou připojí ke své firmě; zakladatel firmu ještě nemá a po 2FA
// pokračuje onboardingem. Do aplikace nikdo nevstoupí bez 2FA.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next");
  const next = requestedNext === "/reset-password" ? requestedNext : "/mfa";
  if (code) {
    const supabase = await createUserServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const session = await getAuthenticatedSession({ requireMfa: false, requireLoginSession: false });
      if (!session) {
        await supabase.auth.signOut();
        return NextResponse.redirect(new URL("/login?error=access", url.origin));
      }

      await setLoginSessionPreference(false, { userId: session.user.id, sessionId: session.sessionId });
      if (next === "/reset-password") {
        return NextResponse.redirect(new URL(next, url.origin));
      }

      // Převezme případnou pozvánku (e-mail je právě ověřený odkazem).
      await resolveMembership(session);
      const verified = await hasVerifiedEmailMfa({
        email: session.email,
        userId: session.user.id,
        sessionId: session.sessionId,
      });
      return NextResponse.redirect(
        new URL(verified ? "/dashboard" : "/mfa", url.origin)
      );
    }
  }
  return NextResponse.redirect(new URL("/login?error=callback", url.origin));
}
