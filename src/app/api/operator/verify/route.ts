import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getOperatorSession } from "@/lib/operator-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { logError, requestId } from "@/lib/structured-log";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ruční ověření firmy provozovatelem (s povinnou poznámkou, zapisuje se do auditu).
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  const session = await getOperatorSession();
  if (!session) return apiError(request, "Nenalezeno.", 404, "not_found");
  const body = await request.json().catch(() => null) as { organizationId?: unknown; note?: unknown } | null;
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (!UUID_RE.test(organizationId) || note.length < 3) return apiError(request, "Vyberte firmu a napište, jak jste ji ověřili.", 400, "invalid_request");
  const { error } = await session.service.rpc("operator_verify_organization", { target_org: organizationId, operator_email: session.email, note });
  if (error) {
    logError("Ruční ověření firmy selhalo", error, { request_id: requestId(request) });
    return apiError(request, "Firmu se nepodařilo ověřit.", 500, "verify_failed");
  }
  return NextResponse.json({ verified: true });
}
