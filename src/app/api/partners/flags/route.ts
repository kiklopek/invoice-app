import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getRequestIdentity } from "@/lib/auth";
import { networkErrorMessage } from "@/lib/partner-network";
import { isSameOriginMutation } from "@/lib/request-security";
import { canViewNetwork } from "@/lib/role-access";
import { logError } from "@/lib/structured-log";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = new Set(["price", "quantity", "not_delivered", "duplicate", "other"]);

// Připomínka k faktuře od partnera: rozpor (s důvodem) nebo „už jsme zaplatili“.
// Je to jen viditelný záznam pro vystavitele -- stav ani peníze faktury nemění.
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const invoiceId = typeof body?.invoice_id === "string" ? body.invoice_id : "";
  const kind = body?.kind;
  if (!UUID_RE.test(invoiceId) || (kind !== "disputed" && kind !== "payment_claimed")) {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (note.length > 1000) return NextResponse.json({ error: "Poznámka může mít nejvýš 1000 znaků." }, { status: 400 });
  const reason = typeof body?.reason === "string" ? body.reason : "";
  if (kind === "disputed" && !REASONS.has(reason)) return NextResponse.json({ error: "Vyberte důvod rozporu." }, { status: 400 });
  const paidOn = typeof body?.paid_on === "string" ? body.paid_on : "";
  const amount = typeof body?.amount === "number" ? body.amount : Number.NaN;
  if (kind === "payment_claimed") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return NextResponse.json({ error: "Zadejte datum platby." }, { status: 400 });
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Zadejte zaplacenou částku." }, { status: 400 });
  }

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canViewNetwork(identity.membership.role)) {
    return NextResponse.json({ error: "Nemáte oprávnění k fakturám partnerů." }, { status: 403 });
  }
  const { data, error } = await identity.service.rpc("network_flag_invoice", {
    target_org: identity.membership.organization_id,
    actor_user: identity.user.id,
    target_invoice: invoiceId,
    flag_kind: kind,
    flag_reason: kind === "disputed" ? reason : null,
    flag_note: note || null,
    paid_on: kind === "payment_claimed" ? paidOn : null,
    paid_amount_value: kind === "payment_claimed" ? Math.round(amount * 100) / 100 : null,
  });
  if (error) {
    const known = networkErrorMessage(error.message);
    if (known) return NextResponse.json({ error: known.message, code: known.code }, { status: known.status });
    logError("Připomínku k faktuře partnera se nepodařilo uložit", error, { invoice_id: invoiceId });
    return apiError(request, "Připomínku se nepodařilo uložit.", 500, "partner_flag_failed");
  }
  return NextResponse.json(data);
}
