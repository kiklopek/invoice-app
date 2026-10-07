import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getOperatorSession } from "@/lib/operator-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { logError, requestId } from "@/lib/structured-log";
import { sendPaidInvoice } from "@/lib/billing-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Potvrzení platby převodem provozovatelem: aktivuje tarif (jednou) a pošle fakturu.
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  const session = await getOperatorSession();
  if (!session) return apiError(request, "Nenalezeno.", 404, "not_found");
  const body = await request.json().catch(() => null) as { orderId?: unknown; note?: unknown } | null;
  const orderId = typeof body?.orderId === "string" ? body.orderId : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (!UUID_RE.test(orderId) || note.length < 3) return apiError(request, "Vyberte objednávku a napište poznámku (např. datum připsání).", 400, "invalid_request");
  const { data, error } = await session.service.rpc("operator_mark_order_paid", { target_order: orderId, operator_email: session.email, note });
  if (error) {
    logError("Potvrzení platby provozovatelem selhalo", error, { request_id: requestId(request) });
    return apiError(request, "Platbu se nepodařilo potvrdit.", 500, "mark_paid_failed");
  }
  const result = data as { already_paid?: boolean };
  if (!result.already_paid) await sendPaidInvoice(orderId);
  return NextResponse.json({ paid: true, already_paid: Boolean(result.already_paid) });
}
