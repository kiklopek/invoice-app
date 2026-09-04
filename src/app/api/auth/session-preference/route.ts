import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { setLoginSessionPreference } from "@/lib/login-session-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { apiError } from "@/lib/api-response";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  }

  const identity = await getRequestIdentity({ requireMfa: false, requireLoginSession: false });
  if (!identity) {
    return apiError(request, "Nejste přihlášený uživatel.", 401, "unauthorized");
  }

  const body = await request.json().catch(() => null) as { remember?: unknown } | null;
  if (typeof body?.remember !== "boolean") {
    return apiError(request, "Neplatná volba přihlášení.", 400, "invalid_preference");
  }

  await setLoginSessionPreference(body.remember, {
    userId: identity.user.id,
    sessionId: identity.sessionId,
  });
  return NextResponse.json({ saved: true });
}
