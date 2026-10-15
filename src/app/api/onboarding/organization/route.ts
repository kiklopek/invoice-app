import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getAuthenticatedSession, resolveMembership } from "@/lib/auth";
import { normalizeOnboardingCompany, onboardingErrorMessage, validateOnboardingCompany } from "@/lib/onboarding";
import { isSameOriginMutation } from "@/lib/request-security";
import { logError, requestId } from "@/lib/structured-log";
import { lookupAresSubject } from "@/lib/ares";
import { consumePublicAuthLimit } from "@/lib/auth-rate-limit";

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

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const company = normalizeOnboardingCompany(body);
  const errors = validateOnboardingCompany(company, { vatPayer: body?.vat_payer === true });
  if (body?.vat_payer !== undefined && typeof body.vat_payer !== "boolean") {
    errors.push({ field: "vat_payer", message: "Uveďte, zda je firma plátcem DPH." });
  }
  if (errors.length) {
    return NextResponse.json({ error: errors[0].message, code: "invalid_company", fields: errors }, { status: 400 });
  }

  try {
    if (!await consumePublicAuthLimit(request, "company_lookup", session.user.id)) {
      return apiError(request, "Příliš mnoho ověření firmy. Zkuste to prosím za chvíli.", 429, "rate_limited");
    }
  } catch (error) {
    logError("Limit ověření firmy se nepodařilo zkontrolovat", error, { request_id: requestId(request) });
    return apiError(request, "Ověření firmy se nepodařilo spustit. Zkuste to prosím znovu.", 503, "company_verification_unavailable");
  }
  // Nález v registru znovu ověří server. Při výpadku registru lze údaje zadat
  // ručně; skutečné „nenalezeno“ se ale nesmí zaměnit za výpadek služby.
  const registry = await lookupAresSubject(company.ico);
  if (registry.status === "not_found" || registry.status === "invalid_ico") {
    const fields = [{ field: "ico", message: "Toto IČO nebylo nalezeno v registru ARES. Zkontrolujte ho prosím." }];
    return NextResponse.json({ error: fields[0].message, code: "invalid_company", fields }, { status: 400 });
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
  // Plátce DPH (výchozí sazba a PDF faktur). Selhání nezastaví onboarding,
  // hodnota jde doplnit v Nastavení → Firma.
  if (typeof body?.vat_payer === "boolean") {
    const { error: vatError } = await session.service.from("organizations").update({ vat_payer: body.vat_payer }).eq("id", result.organization_id);
    if (vatError) logError("Plátcovství DPH se nepodařilo uložit", vatError, { request_id: requestId(request) });
  }
  const { error: draftError } = await session.service.from("onboarding_drafts").delete().eq("user_id", session.user.id);
  if (draftError) logError("Úklid dokončeného onboardingu selhal", draftError, { request_id: requestId(request) });
  return NextResponse.json({ created: true, redirect: "/dashboard" }, { status: 201 });
}
