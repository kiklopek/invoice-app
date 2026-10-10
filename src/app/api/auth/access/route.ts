import { NextResponse } from "next/server";
import { getAuthenticatedSession, resolveMembership } from "@/lib/auth";
import { getBearerAccessToken, isSameOriginMutation } from "@/lib/request-security";
import { displayName } from "@/lib/user-display";
import { apiError } from "@/lib/api-response";
import { isEmailMfaBypassed } from "@/lib/email-mfa-core";

// Stav po přihlášení heslem. Člen firmy dostane svou firmu a roli;
// ověřený účet bez firmy je zakladatel před onboardingem (needsOnboarding).
// 2FA se tu ještě nevyžaduje -- tahle odpověď rozhoduje, kam po hesle dál.
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  }
  const session = await getAuthenticatedSession({
    requireMfa: false,
    requireLoginSession: false,
    accessToken: getBearerAccessToken(request),
  });
  if (!session) {
    return apiError(request, "Tento účet nemá aktivní přístup do aplikace.", 403, "access_denied");
  }
  const name = displayName(session.user.user_metadata.full_name, session.email);
  const mfaBypassed = isEmailMfaBypassed(session.email);

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
