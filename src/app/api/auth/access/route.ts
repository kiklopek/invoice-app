import { NextResponse } from "next/server";
import { getAuthenticatedSession, resolveMembership } from "@/lib/auth";
import { getBearerAccessToken, isSameOriginMutation } from "@/lib/request-security";
import { displayName } from "@/lib/user-display";
import { apiError } from "@/lib/api-response";
import { isEmailMfaBypassed } from "@/lib/email-mfa-core";
import { trustDeviceSession } from "@/lib/email-mfa-server";
import { setLoginSessionPreference } from "@/lib/login-session-server";
import { withServerTiming } from "@/lib/server-timing";
import { requestId } from "@/lib/structured-log";

// Stav po přihlášení heslem. Člen firmy dostane svou firmu a roli;
// ověřený účet bez firmy je zakladatel před onboardingem (needsOnboarding).
// 2FA se tu ještě nevyžaduje -- tahle odpověď rozhoduje, kam po hesle dál.
// Na důvěryhodném zařízení (kód tu byl zadán v posledních 30 dnech) se nová
// session rovnou ověří a login form kód přeskočí (mfa_bypassed).
export async function POST(request: Request) {
  return withServerTiming(() => applicationAccess(request));
}

async function applicationAccess(request: Request) {
  if (!isSameOriginMutation(request)) {
    return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  }
  // Older callers send no body. Only an explicit boolean changes cookies.
  const bodyText = await request.text();
  let remember: boolean | undefined;
  if (bodyText.trim()) {
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return apiError(request, "Neplatná volba přihlášení.", 400, "invalid_preference");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)
      || ("remember" in body && typeof body.remember !== "boolean")) {
      return apiError(request, "Neplatná volba přihlášení.", 400, "invalid_preference");
    }
    if ("remember" in body) remember = body.remember as boolean;
  }
  const session = await getAuthenticatedSession({
    requireMfa: false,
    requireLoginSession: false,
    accessToken: getBearerAccessToken(request),
    diagnosticRequestId: requestId(request),
  });
  if (!session) {
    return apiError(request, "Přihlašovací relaci se nepodařilo ověřit. Přihlaste se prosím znovu.", 401, "invalid_session");
  }
  // The trusted-device MFA cookie reads this preference to choose its TTL.
  // Both operations use the same verified account/session, including founders.
  if (remember !== undefined) {
    await setLoginSessionPreference(remember, { userId: session.user.id, sessionId: session.sessionId });
  }
  const name = displayName(session.user.user_metadata.full_name, session.email);
  const mfaBypassed = isEmailMfaBypassed(session.email)
    || await trustDeviceSession({ userId: session.user.id, sessionId: session.sessionId });

  const identity = await resolveMembership(session);
  if (!identity) {
    return NextResponse.json({
      allowed: true,
      needsOnboarding: true,
      role: null,
      name,
      email: session.email,
      companyName: null,
      companyLogo: null,
      mfa_bypassed: mfaBypassed,
    });
  }

  const { data: organization } = await identity.service
    .from("organizations")
    .select("name, logo_path, vat_payer")
    .eq("id", identity.membership.organization_id)
    .single();
  return NextResponse.json({
    allowed: true,
    needsOnboarding: false,
    role: identity.membership.role,
    name,
    email: session.email,
    companyName: organization?.name?.trim() || "Firma",
    companyLogo: organization?.logo_path ?? null,
    vatPayer: organization?.vat_payer ?? null,
    mfa_bypassed: mfaBypassed,
  });
}
