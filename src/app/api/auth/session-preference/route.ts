import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth";
import { setLoginSessionPreference } from "@/lib/login-session-server";
import { getBearerAccessToken, isSameOriginMutation } from "@/lib/request-security";
import { apiError } from "@/lib/api-response";
import { withServerTiming } from "@/lib/server-timing";

export async function POST(request: Request) {
  return withServerTiming(() => sessionPreference(request));
}

async function sessionPreference(request: Request) {
  if (!isSameOriginMutation(request)) {
    return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  }

  // A new founder must save their login before MFA and company onboarding.
  // Membership is required by company-data routes, not by this session cookie.
  const identity = await getAuthenticatedSession({
    requireMfa: false,
    requireLoginSession: false,
    accessToken: getBearerAccessToken(request),
  });
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
