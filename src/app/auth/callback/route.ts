import { createUserServerClient } from "@/lib/supabase-server";
import { getRequestIdentity } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createUserServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const identity = await getRequestIdentity();
      if (identity) return NextResponse.redirect(new URL("/dashboard", url.origin));
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/login?error=access", url.origin));
    }
  }
  return NextResponse.redirect(new URL("/login?error=callback", url.origin));
}
