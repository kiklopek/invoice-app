import { NextResponse } from "next/server";
import { emailMatchesDomain, isDisposableEmail, isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { CUSTOM_ENTRY, registrationAccessDecision } from "@/lib/tenant-entries";
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
  // Rozhodnutí (vstup firmy vs. obecná registrace) je v tenant-entries.ts.
  return NextResponse.json(registrationAccessDecision({
    entry: body.entry,
    emailMatchesEntryDomain: emailMatchesDomain(email, CUSTOM_ENTRY.emailDomain),
    invitation: row ? { claimed: Boolean(row.user_id), organizationDomain: organization?.allowed_email_domain } : null,
    disposable: isDisposableEmail(email),
  }));
}
