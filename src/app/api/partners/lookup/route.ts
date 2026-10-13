import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getRequestIdentity } from "@/lib/auth";
import { networkErrorMessage, normalizeIcoInput } from "@/lib/partner-network";
import { canManageNetwork } from "@/lib/role-access";
import { logError } from "@/lib/structured-log";

// Co se stane s IČO: je firma ve Splatnu, jsme propojení, čeká žádost?
// Prozradí jen název firmy, kterou lze oslovit -- nic z jejích dat.
export async function GET(request: Request) {
  const ico = normalizeIcoInput(new URL(request.url).searchParams.get("ico") ?? "");
  if (ico.length !== 8) return NextResponse.json({ state: "invalid_ico" });

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageNetwork(identity.membership.role)) {
    return NextResponse.json({ error: "Propojovat firmy může pouze administrátor." }, { status: 403 });
  }
  const { data, error } = await identity.service.rpc("network_lookup", {
    target_org: identity.membership.organization_id,
    actor_user: identity.user.id,
    target_ico: ico,
  });
  if (error) {
    const known = networkErrorMessage(error.message);
    if (known) return NextResponse.json({ error: known.message, code: known.code }, { status: known.status });
    logError("Vyhledání firmy v síti selhalo", error);
    return apiError(request, "Firmu se nepodařilo vyhledat.", 500, "partner_lookup_failed");
  }
  return NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
}
