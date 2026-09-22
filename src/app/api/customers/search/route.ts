import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { getRequestIdentity } from "@/lib/auth";
import { canViewFinancialInsights } from "@/lib/role-access";
import { customerSearchFilter, sanitizeCustomerSearch } from "@/lib/customer-search-query";

export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canViewFinancialInsights(identity.membership.role))
    return NextResponse.json({ error: "K vyhledávání zákazníků nemáte přístup." }, { status: 403 });

  // Vstup se sklada do PostgREST `or()` retezce, kde carka a zavorky jsou
  // ridici znaky -- driv se escapovalo jen % a _, takze slo pripojit dalsi
  // podminku a filtrovat podle sloupcu mimo select. sanitizeCustomerSearch
  // pouziva allowlist; blacklist na tenhle jazyk jde vzdycky obejit.
  const safeQuery = sanitizeCustomerSearch(new URL(request.url).searchParams.get("q"));
  if (!safeQuery) return NextResponse.json({ customers: [] });

  const { data, error } = await identity.service
    .from("customers")
    .select("id, name, ico, dic, email")
    .eq("organization_id", identity.membership.organization_id)
    .or(customerSearchFilter(safeQuery))
    .order("name", { ascending: true })
    .limit(10);
  if (error) {
    logError("Vyhledávání zákazníků selhalo", error);
    return apiError(request, "Zákazníky se nepodařilo vyhledat.", 500, "customer_search_failed");
  }
  return NextResponse.json({ customers: data ?? [] });
}
