import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getRequestIdentity } from "@/lib/auth";
import { requireEmailMfaSecret } from "@/lib/email-mfa-server";
import { verificationCodeHash } from "@/lib/isds";
import { isSameOriginMutation } from "@/lib/request-security";
import { canManageMembers } from "@/lib/role-access";
import { logError, requestId } from "@/lib/structured-log";

const RESULTS: Record<string, { http: number; message: string }> = {
  verified: { http: 200, message: "Firma je ověřená." },
  invalid: { http: 400, message: "Kód nesouhlasí. Zkontrolujte ho ve zprávě v datové schránce." },
  expired: { http: 410, message: "Platnost kódu vypršela. Pošlete si nový." },
  locked: { http: 429, message: "Kód byl zadán špatně pětkrát. Pošlete si nový." },
  not_found: { http: 404, message: "Žádný kód nečeká na zadání. Pošlete si ho do datové schránky." },
};

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  const identity = await getRequestIdentity();
  if (!identity) return apiError(request, "Nejste přihlášený uživatel.", 401, "unauthorized");
  if (!canManageMembers(identity.membership.role)) return apiError(request, "Firmu může ověřit jen administrátor.", 403, "forbidden");
  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.replace(/\s/g, "") : "";
  if (!/^\d{6}$/.test(code)) return apiError(request, "Zadejte šestimístný kód.", 400, "invalid_code");

  const organizationId = identity.membership.organization_id;
  const { data, error } = await identity.service.rpc("verify_data_box_code", {
    target_org: organizationId,
    actor_user: identity.user.id,
    candidate_hash: verificationCodeHash({ organizationId, code, secret: requireEmailMfaSecret() }),
  });
  if (error) {
    logError("Ověření kódu z datové schránky selhalo", error, { request_id: requestId(request) });
    return apiError(request, "Kód se nepodařilo ověřit.", 500, "verification_failed");
  }
  const result = RESULTS[String(data)] ?? RESULTS.not_found;
  return NextResponse.json({ status: data, message: result.message }, { status: result.http });
}
