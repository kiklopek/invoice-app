import { NextResponse } from "next/server";
import { clearEmailMfaCookie } from "@/lib/email-mfa-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { createUserServerClient, isDemoMode } from "@/lib/supabase-server";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  await clearEmailMfaCookie();
  if (!isDemoMode()) {
    const supabase = await createUserServerClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) return NextResponse.json({ error: "Odhlášení se nepodařilo." }, { status: 500 });
  }
  return NextResponse.json({ signed_out: true });
}
