import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getAuthenticatedSession, resolveMembership } from "@/lib/auth";
import { normalizeOnboardingCompany, onboardingErrorMessage, validateOnboardingCompany } from "@/lib/onboarding";
import { isSameOriginMutation } from "@/lib/request-security";
import { logError, requestId } from "@/lib/structured-log";

// Dokončení onboardingu: firma, zakladatel jako admin a výchozí (vypnuté)
// upomínky vzniknou naráz v databázi. Dvojklik ani souběžný požadavek
// nezaloží druhou firmu -- hlídá to create_organization_for_user.
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  }
  const session = await getAuthenticatedSession();
  if (!session) return apiError(request, "Nejste přihlášený uživatel.", 401, "unauthorized");

  if (await resolveMembership(session)) {
    const known = onboardingErrorMessage("already_member")!;
    return apiError(request, known.message, known.status, known.code);
  }

  const company = normalizeOnboardingCompany(await request.json().catch(() => null));
  const errors = validateOnboardingCompany(company);
  if (errors.length) {
    return NextResponse.json({ error: errors[0].message, code: "invalid_company", fields: errors }, { status: 400 });
  }

  const { data, error } = await session.service.rpc("create_organization_for_user", {
    founder_user: session.user.id,
    company,
  });
  if (error) {
    const known = onboardingErrorMessage(error.message);
    if (!known) logError("Založení firmy selhalo", error, { request_id: requestId(request) });
    return apiError(request, known?.message ?? "Firmu se nepodařilo založit. Zkuste to prosím znovu.", known?.status ?? 500, known?.code ?? "organization_create_failed");
  }
  const result = data as { organization_id?: string } | null;
  if (!result?.organization_id) {
    logError("Založení firmy nevrátilo firmu", null, { request_id: requestId(request) });
    return apiError(request, "Založení firmy se nepodařilo potvrdit.", 500, "organization_create_unconfirmed");
  }
  return NextResponse.json({ created: true, redirect: "/dashboard" }, { status: 201 });
}
