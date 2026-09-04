import { NextResponse } from "next/server";
import { clearEmailMfaCookie } from "@/lib/email-mfa-server";
import { clearLoginSessionPreference } from "@/lib/login-session-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { createUserServerClient, isDemoMode } from "@/lib/supabase-server";
import { apiError } from "@/lib/api-response";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  const body = await request.json().catch(() => null) as { scope?: unknown } | null;
  const scope = body?.scope === "global" ? "global" : "local";
  await clearEmailMfaCookie();
  await clearLoginSessionPreference();
  if (!isDemoMode()) {
    const supabase = await createUserServerClient();
    const { error } = await supabase.auth.signOut({ scope });
    if (error) return apiError(request, "Odhlášení se nepodařilo.", 500, "sign_out_failed");
  }
  return NextResponse.json({ signed_out: true, scope });
}
