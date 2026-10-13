import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getRequestIdentity } from "@/lib/auth";
import { hashNetworkInvitationToken, isNetworkInvitationToken } from "@/lib/network-invitations";
import { networkErrorMessage } from "@/lib/partner-network";
import { isSameOriginMutation } from "@/lib/request-security";
import { canManageNetwork } from "@/lib/role-access";
import { createServiceClient } from "@/lib/supabase-server";
import { logError } from "@/lib/structured-log";

type Context = { params: Promise<{ token: string }> };

// Odkaz z pozvánky do sítě. „opt_out“ je veřejné (odhlášení z dalších pozvánek
// musí jít jedním kliknutím bez účtu); „accept“ vyžaduje přihlášeného admina
// firmy, jejíž IČO odpovídá pozvánce -- to ověří network_accept_invitation.
export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const { token } = await params;
  if (!isNetworkInvitationToken(token)) return NextResponse.json({ error: "Odkaz pozvánky je neplatný." }, { status: 404 });
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  const tokenHash = hashNetworkInvitationToken(token);

  if (body?.action === "opt_out") {
    const { data, error } = await createServiceClient().rpc("network_invitation_opt_out", { target_token_hash: tokenHash });
    if (error) {
      logError("Odhlášení z pozvánek do sítě selhalo", error);
      return apiError(request, "Odhlášení se nepodařilo. Zkuste to prosím znovu.", 500, "network_opt_out_failed");
    }
    if (!data) return NextResponse.json({ error: "Odkaz pozvánky je neplatný." }, { status: 404 });
    return NextResponse.json({ opted_out: true });
  }
  if (body?.action !== "accept") return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageNetwork(identity.membership.role)) {
    return NextResponse.json({ error: "Pozvánku do sítě může přijmout pouze administrátor firmy." }, { status: 403 });
  }
  const { data, error } = await identity.service.rpc("network_accept_invitation", {
    target_org: identity.membership.organization_id,
    actor_user: identity.user.id,
    target_token_hash: tokenHash,
  });
  if (error) {
    const known = networkErrorMessage(error.message);
    if (known) return NextResponse.json({ error: known.message, code: known.code }, { status: known.status });
    logError("Pozvánku do sítě se nepodařilo přijmout", error);
    return apiError(request, "Pozvánku se nepodařilo přijmout.", 500, "network_invitation_accept_failed");
  }
  return NextResponse.json(data);
}
