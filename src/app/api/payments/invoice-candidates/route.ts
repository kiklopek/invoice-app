import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { canUseGpcImport } from "@/lib/gpc-feature";

export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  if (!identity)
    return NextResponse.json(
      { error: "Nejste přihlášený uživatel." },
      { status: 401 },
    );
  if (
    !canManageInvoices(identity.membership.role) ||
    !canUseGpcImport(identity.membership.role)
  )
    return NextResponse.json(
      { error: "Nemáte oprávnění vyhledávat faktury pro párování." },
      { status: 403 },
    );
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim();
  const page = Number(params.get("page") ?? "1");
  if (query.length > 100 || !Number.isInteger(page) || page < 1)
    return NextResponse.json(
      { error: "Neplatné hledání nebo stránka." },
      { status: 400 },
    );
  const { data, error } = await identity.service.rpc(
    "list_open_invoice_candidates",
    {
      target_org: identity.membership.organization_id,
      actor_user: identity.user.id,
      search_query: query || undefined,
      page_number: page,
      page_size: 25,
    },
  );
  if (error) {
    logError("Kandidátní faktury se nepodařilo načíst", error);
    return apiError(request, "Kandidátní faktury se nepodařilo načíst.", 500, "invoice_candidates_read_failed");
  }
  return NextResponse.json(data, {
    headers: { "cache-control": "private, no-store" },
  });
}
