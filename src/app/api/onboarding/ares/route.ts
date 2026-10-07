import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { lookupAresSubject } from "@/lib/ares";
import { getAuthenticatedSession } from "@/lib/auth";
import { consumePublicAuthLimit } from "@/lib/auth-rate-limit";
import { isSameOriginMutation } from "@/lib/request-security";
import { logError, requestId } from "@/lib/structured-log";

// Dohledání firmy podle IČO v ARES během onboardingu. Výpadek ARES
// onboarding nezasekne: vrátí "unavailable" a údaje se vyplní ručně.
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  }
  const session = await getAuthenticatedSession();
  if (!session) return apiError(request, "Nejste přihlášený uživatel.", 401, "unauthorized");

  const body = await request.json().catch(() => null) as { ico?: unknown } | null;
  const ico = typeof body?.ico === "string" ? body.ico.replace(/\s/g, "") : "";
  if (!/^\d{8}$/.test(ico)) return NextResponse.json({ status: "invalid_ico" });

  try {
    if (!await consumePublicAuthLimit(request, "company_lookup", session.user.id)) {
      return apiError(request, "Příliš mnoho dotazů. Zkuste to za chvíli nebo údaje vyplňte ručně.", 429, "rate_limited");
    }
  } catch (error) {
    logError("Limit dotazů do ARES se nepodařilo ověřit", error, { request_id: requestId(request) });
    return NextResponse.json({ status: "unavailable" });
  }

  const result = await lookupAresSubject(ico);
  if (result.status === "found") return NextResponse.json({ status: "found", subject: result.subject });
  return NextResponse.json({ status: result.status });
}
