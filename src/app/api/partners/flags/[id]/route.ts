import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getRequestIdentity } from "@/lib/auth";
import { networkErrorMessage } from "@/lib/partner-network";
import { isSameOriginMutation } from "@/lib/request-security";
import { canViewNetwork } from "@/lib/role-access";
import { logError } from "@/lib/structured-log";

type Context = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Vystavitel připomínku vyřeší nebo zamítne, autor ji může stáhnout.
// Kdo smí co, hlídá databázová funkce network_decide_flag.
export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Neplatný identifikátor připomínky." }, { status: 400 });
  const body = await request.json().catch(() => null) as { decision?: unknown; note?: unknown } | null;
  const decision = body?.decision;
  if (decision !== "resolved" && decision !== "rejected" && decision !== "withdrawn") {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (note.length > 1000) return NextResponse.json({ error: "Poznámka může mít nejvýš 1000 znaků." }, { status: 400 });

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canViewNetwork(identity.membership.role)) {
    return NextResponse.json({ error: "Nemáte oprávnění k připomínkám partnerů." }, { status: 403 });
  }
  const { data, error } = await identity.service.rpc("network_decide_flag", {
    target_org: identity.membership.organization_id,
    actor_user: identity.user.id,
    target_flag: id,
    decision,
    decision_note: note || null,
  });
  if (error) {
    const known = networkErrorMessage(error.message);
    if (known) return NextResponse.json({ error: known.message, code: known.code }, { status: known.status });
    logError("Připomínku partnera se nepodařilo vyřídit", error, { flag_id: id });
    return apiError(request, "Připomínku se nepodařilo vyřídit.", 500, "partner_flag_decision_failed");
  }
  return NextResponse.json(data);
}
