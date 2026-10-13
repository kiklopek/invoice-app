import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getRequestIdentity } from "@/lib/auth";
import { canViewNetwork } from "@/lib/role-access";
import { logError } from "@/lib/structured-log";

type Context = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Vidí odběratel tuto fakturu ve Splatnu (propojený partner) a má k ní připomínky?
// Pro čtenáře a nepropojené odběratele vrací null -- detail faktury pak nic neukáže.
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Neplatný identifikátor faktury." }, { status: 400 });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canViewNetwork(identity.membership.role)) return NextResponse.json(null);
  const { data, error } = await identity.service.rpc("network_invoice_context", {
    target_org: identity.membership.organization_id, actor_user: identity.user.id, target_invoice: id,
  });
  if (error) {
    logError("Stav faktury v síti partnerů se nepodařilo načíst", error, { invoice_id: id });
    return apiError(request, "Stav faktury v síti se nepodařilo načíst.", 500, "invoice_network_failed");
  }
  return NextResponse.json(data ?? null, { headers: { "cache-control": "private, no-store" } });
}
