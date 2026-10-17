import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError, requestId } from "@/lib/structured-log";
import { getRequestIdentity } from "@/lib/auth";
import { canViewFinancialInsights } from "@/lib/role-access";
import { legacyCustomerSearchFilter, parseCustomerSearchQuery } from "@/lib/customer-search-query";

export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canViewFinancialInsights(identity.membership.role))
    return NextResponse.json({ error: "K vyhledávání zákazníků nemáte přístup." }, { status: 403 });

  const parsed = parseCustomerSearchQuery(new URL(request.url).searchParams.get("q"));
  if (!parsed.valid) {
    logError("Neplatný vyhledávací dotaz zákazníků", new Error("invalid_search"), { request_id: requestId(request) });
    return apiError(request, "Vyhledávací dotaz je neplatný nebo příliš dlouhý.", 400, "invalid_search");
  }
  if (!parsed.query) return NextResponse.json({ customers: [] });

  let { data, error } = await identity.service
    .rpc("search_customers", {
      target_org: identity.membership.organization_id,
      actor_user: identity.user.id,
      search_query: parsed.query,
    });
  if (error?.code === "PGRST202" || error?.code === "42883") {
    const filter = legacyCustomerSearchFilter(parsed.query);
    if (!filter) return NextResponse.json({ customers: [] });
    ({ data, error } = await identity.service.from("customers")
      .select("id, name, ico, dic, email")
      .eq("organization_id", identity.membership.organization_id)
      .or(filter).order("name", { ascending: true }).limit(10));
  }
  if (error) {
    logError("Vyhledávání zákazníků selhalo", error, { request_id: requestId(request) });
    return apiError(request, "Zákazníky se nepodařilo vyhledat.", 500, "customer_search_failed");
  }
  return NextResponse.json({ customers: data ?? [] });
}
