import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getRequestIdentity } from "@/lib/auth";
import { consumePublicAuthLimit } from "@/lib/auth-rate-limit";
import { isSameOriginMutation } from "@/lib/request-security";
import { canManageMembers } from "@/lib/role-access";
import { logError, requestId } from "@/lib/structured-log";
import { startDataBoxVerification } from "@/lib/verification-server";

const MESSAGES: Record<string, { http: number; message: string }> = {
  already_verified: { http: 409, message: "Firma už je ověřená." },
  manual: { http: 202, message: "Automatické ověření teď není k dispozici. Firmu ověříme ručně, ozveme se vám." },
  no_data_box: { http: 404, message: "K IČO firmy jsme nenašli datovou schránku. Napište nám a ověříme firmu jinak." },
  unavailable: { http: 503, message: "Datové schránky teď neodpovídají. Zkuste to prosím za chvíli." },
};

// Pošle ověřovací kód do datové schránky firmy (dohledané podle IČO).
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  const identity = await getRequestIdentity();
  if (!identity) return apiError(request, "Nejste přihlášený uživatel.", 401, "unauthorized");
  if (!canManageMembers(identity.membership.role)) return apiError(request, "Firmu může ověřit jen administrátor.", 403, "forbidden");
  try {
    if (!await consumePublicAuthLimit(request, "company_lookup", `verify:${identity.membership.organization_id}`)) {
      return apiError(request, "Příliš mnoho pokusů. Zkuste to za chvíli.", 429, "rate_limited");
    }
  } catch (error) {
    logError("Limit ověření firmy se nepodařilo ověřit", error, { request_id: requestId(request) });
    return apiError(request, "Ověření teď není dostupné.", 503, "rate_limit_unavailable");
  }
  const result = await startDataBoxVerification(identity);
  if (result.status === "sent") return NextResponse.json(result);
  const known = MESSAGES[result.status];
  if (result.status === "unavailable") logError("Ověření datovou schránkou selhalo", null, { request_id: requestId(request) });
  return NextResponse.json({ status: result.status, error: known.message }, { status: known.http });
}
