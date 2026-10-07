import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getRequestIdentity } from "@/lib/auth";
import { createOrder } from "@/lib/billing-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { logError, requestId } from "@/lib/structured-log";

// Objednávka tarifu. Částku určuje server, prohlížeč posílá jen volbu.
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied");
  const identity = await getRequestIdentity();
  if (!identity) return apiError(request, "Nejste přihlášený uživatel.", 401, "unauthorized");
  if (identity.membership.role !== "admin") return apiError(request, "Tarif může koupit jen administrátor firmy.", 403, "forbidden");
  const body = await request.json().catch(() => null);
  const result = await createOrder(identity, body ?? {});
  if (result.ok) return NextResponse.json({ order_id: result.orderId, redirect: result.redirect }, { status: 201 });
  if (result.status >= 500) logError("Objednávka tarifu selhala", null, { code: result.code, request_id: requestId(request) });
  return apiError(request, result.error, result.status, result.code);
}
