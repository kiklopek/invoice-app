import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getRequestIdentity } from "@/lib/auth";
import { PageDataError } from "@/lib/dashboard-page-data";
import { isLookupIco, networkErrorMessage, normalizeIcoInput } from "@/lib/partner-network";
import { loadPartnersPageData } from "@/lib/partners-page-data";
import { isSameOriginMutation } from "@/lib/request-security";
import { canManageNetwork } from "@/lib/role-access";
import { logError } from "@/lib/structured-log";

// GET: přehled sítě (partneři, žádosti, návrhy, pozvánky). POST: žádost o propojení podle IČO.
export async function GET(request: Request) {
  try {
    const identity = await getRequestIdentity();
    const data = await loadPartnersPageData(identity);
    return NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PageDataError) return NextResponse.json({ error: error.message }, { status: error.status });
    logError("Přehled sítě partnerů se nepodařilo načíst", error);
    return apiError(request, "Partnery se nepodařilo načíst.", 500, "partners_page_data_failed");
  }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { ico?: unknown; message?: unknown; origin?: unknown } | null;
  const ico = typeof body?.ico === "string" ? normalizeIcoInput(body.ico) : "";
  if (!isLookupIco(ico)) return NextResponse.json({ error: "Zadejte platné IČO (8 číslic s kontrolní číslicí)." }, { status: 400 });
  if (body?.message !== undefined && body.message !== null && typeof body.message !== "string") {
    return NextResponse.json({ error: "Neplatná zpráva." }, { status: 400 });
  }
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (message.length > 500) return NextResponse.json({ error: "Zpráva může mít nejvýš 500 znaků." }, { status: 400 });
  const origin = body?.origin === "suggestion" ? "suggestion" : "search";

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageNetwork(identity.membership.role)) {
    return NextResponse.json({ error: "Propojovat firmy může pouze administrátor." }, { status: 403 });
  }

  const { data, error } = await identity.service.rpc("network_request", {
    target_org: identity.membership.organization_id,
    actor_user: identity.user.id,
    target_ico: ico,
    request_message: message || null,
    request_origin: origin,
  });
  if (error) {
    const known = networkErrorMessage(error.message);
    if (known) return NextResponse.json({ error: known.message, code: known.code }, { status: known.status });
    logError("Žádost o propojení se nepodařilo odeslat", error);
    return apiError(request, "Žádost o propojení se nepodařilo odeslat.", 500, "partner_request_failed");
  }
  return NextResponse.json(data);
}
