import { NextResponse } from "next/server";
import { emailMatchesDomain, isDisposableEmail, isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { HLAVICA_ENTRY } from "@/lib/tenant-entries";
import { isSameOriginMutation } from "@/lib/request-security";
import { createServiceClient } from "@/lib/supabase-server";
import { apiError } from "@/lib/api-response";
import { consumePublicAuthLimit } from "@/lib/auth-rate-limit";
import { logError, requestId } from "@/lib/structured-log";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  }

  let body: { email?: unknown; entry?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; entry?: unknown };
  } catch {
    return apiError(request, "Neplatný požadavek.", 400, "invalid_request");
  }

  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  if (!isValidEmail(email)) {
    return apiError(request, "Neplatná e-mailová adresa.", 400, "invalid_email");
  }

  try {
    if (!await consumePublicAuthLimit(request, "registration_access", email)) {
      return apiError(request, "Příliš mnoho pokusů. Zkuste to znovu za několik minut.", 429, "rate_limited");
    }
  } catch (error) {
    logError("Registration rate limit failed", error, { request_id: requestId(request) });
    return apiError(request, "Ověření přístupu se momentálně nepodařilo.", 503, "rate_limit_unavailable");
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("organization_members")
    .select("id, user_id, organizations(allowed_email_domain)")
    .eq("email", email)
    .limit(1);

  if (error) {
    logError("Registration membership lookup failed", error, { request_id: requestId(request) });
    return apiError(request, "Ověření přístupu se nepodařilo.", 500, "membership_lookup_failed");
  }

  const row = data?.[0];
  const organization = Array.isArray(row?.organizations) ? row.organizations[0] : row?.organizations;
  const hlavicaEmail = emailMatchesDomain(email, HLAVICA_ENTRY.emailDomain);
  const hlavicaInvitation = organization?.allowed_email_domain === HLAVICA_ENTRY.emailDomain;

  // Vstup R. Hlavica (splatno.cz/hlavica/registrace) funguje jako dřív:
  // jen e-mail @hlavica.cz, který administrátor R. Hlavica předem pozval.
  if (body.entry === "hlavica") {
    if (!hlavicaEmail || !row || !hlavicaInvitation) return NextResponse.json({ allowed: false, kind: "not_invited" });
    if (row.user_id) return NextResponse.json({ allowed: false, kind: "member" });
    return NextResponse.json({ allowed: true, kind: "invited" });
  }

  // Obecná registrace s R. Hlavica nijak nesouvisí: jejich lidi posílá na
  // jejich vlastní registraci, aby si omylem nezaložili samostatnou firmu.
  if (hlavicaEmail || hlavicaInvitation) return NextResponse.json({ allowed: false, kind: "hlavica" });
  // Ostatní: s pozvánkou se po potvrzení e-mailu připojí ke své firmě
  // ("invited"), bez ní zakládají firmu ("founder"). Kdo už účet má, se
  // registrovat nemá -- má se přihlásit.
  if (row?.user_id) return NextResponse.json({ allowed: false, kind: "member" });
  // Zakladatel firmy z jednorázové schránky: ochrana zkušební doby.
  if (!row && isDisposableEmail(email)) return NextResponse.json({ allowed: false, kind: "disposable" });
  return NextResponse.json({ allowed: true, kind: row ? "invited" : "founder" });
}
