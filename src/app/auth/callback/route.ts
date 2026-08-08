import { createUserServerClient } from "@/lib/supabase-server";
import { getRequestIdentity } from "@/lib/auth";
import { isAllowedCorporateEmail } from "@/lib/auth-policy";
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

      const identity = await getRequestIdentity({ requireMfa: false });
      if (!identity) {
        await supabase.auth.signOut();
        return NextResponse.redirect(new URL("/login?error=access", url.origin));
      }

      if (next === "/reset-password") {
        return NextResponse.redirect(new URL(next, url.origin));
      }

      const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      return NextResponse.redirect(
        new URL(assurance?.currentLevel === "aal2" ? "/dashboard" : "/mfa", url.origin)
      );
    }
  }
  return NextResponse.redirect(new URL("/login?error=callback", url.origin));
}
