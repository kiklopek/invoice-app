import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getRequestIdentity } from "@/lib/auth";
import { PageDataError } from "@/lib/dashboard-page-data";
import { networkErrorMessage } from "@/lib/partner-network";
import { loadPartnerDetailPageData } from "@/lib/partners-page-data";
import { isSameOriginMutation } from "@/lib/request-security";
import { canManageNetwork } from "@/lib/role-access";
import { logError } from "@/lib/structured-log";

type Context = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Neplatný identifikátor propojení." }, { status: 400 });
  try {
    const data = await loadPartnerDetailPageData(await getRequestIdentity(), id);
    return NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PageDataError) return NextResponse.json({ error: error.message }, { status: error.status });
    logError("Detail partnera se nepodařilo načíst", error, { connection_id: id });
    return apiError(request, "Detail partnera se nepodařilo načíst.", 500, "partner_detail_failed");
  }
}

// Přijetí / odmítnutí příchozí žádosti a sdílení historie zaplacených faktur.
export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Neplatný identifikátor propojení." }, { status: 400 });
  const body = await request.json().catch(() => null) as { action?: unknown; share?: unknown } | null;
  const action = body?.action;
  if (action !== "accept" && action !== "decline" && action !== "share_history") {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  if (action === "share_history" && typeof body?.share !== "boolean") {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageNetwork(identity.membership.role)) {
    return NextResponse.json({ error: "Propojení spravuje pouze administrátor." }, { status: 403 });
  }
  const base = { target_org: identity.membership.organization_id, actor_user: identity.user.id, target_connection: id };
  const { data, error } = action === "share_history"
    ? await identity.service.rpc("network_set_share_history", { ...base, share: body?.share === true })
    : await identity.service.rpc("network_respond", { ...base, accept: action === "accept" });
  if (error) {
    const known = networkErrorMessage(error.message);
    if (known) return NextResponse.json({ error: known.message, code: known.code }, { status: known.status });
    logError("Propojení se nepodařilo upravit", error, { connection_id: id, action });
    return apiError(request, "Propojení se nepodařilo upravit.", 500, "partner_update_failed");
  }
  return NextResponse.json(data);
}

// Zrušení odchozí žádosti nebo aktivního propojení. Přístup končí okamžitě.
export async function DELETE(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Neplatný identifikátor propojení." }, { status: 400 });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageNetwork(identity.membership.role)) {
    return NextResponse.json({ error: "Propojení spravuje pouze administrátor." }, { status: 403 });
  }
  const { data, error } = await identity.service.rpc("network_revoke", {
    target_org: identity.membership.organization_id, actor_user: identity.user.id, target_connection: id,
  });
  if (error) {
    const known = networkErrorMessage(error.message);
    if (known) return NextResponse.json({ error: known.message, code: known.code }, { status: known.status });
    logError("Propojení se nepodařilo zrušit", error, { connection_id: id });
    return apiError(request, "Propojení se nepodařilo zrušit.", 500, "partner_revoke_failed");
  }
  return NextResponse.json(data);
}
