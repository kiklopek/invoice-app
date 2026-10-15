import { NextResponse } from "next/server";
import { isValidEmail, normalizeEmail } from "@/lib/auth-policy";
import { getRegistrationAccess } from "@/lib/registration-access-server";
import { isSameOriginMutation } from "@/lib/request-security";
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

  try {
    return NextResponse.json(await getRegistrationAccess(email, body.entry));
  } catch (error) {
    logError("Registration membership lookup failed", error, { request_id: requestId(request) });
    return apiError(request, "Ověření přístupu se nepodařilo.", 500, "membership_lookup_failed");
  }
}
