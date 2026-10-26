import "server-only";
import { normalizeSearchText } from "./text-search";
import { paymentSearchPattern } from "./workspace-search";
import type { RequestIdentity } from "./auth";
import { legacyCustomerSearchFilter } from "./customer-search-query";
import { PageDataError } from "./dashboard-page-data";

export type CustomerSearchResult = {
  id: string;
  name: string;
  ico: string | null;
  dic: string | null;
  email: string | null;
};

// Callers authenticate, authorize and validate the query before this read.
export async function searchCustomers(
  identity: RequestIdentity,
  query: string,
): Promise<CustomerSearchResult[]> {
  // The existing RPC deliberately starts at two characters. A bounded name
  // prefix lookup supplies immediate suggestions for the first typed letter.
  if (normalizeSearchText(query).length === 1) {
    const { data, error } = await identity.service
      .from("customers")
      .select("id, name, ico, dic, email")
      .eq("organization_id", identity.membership.organization_id)
      .filter("name", "imatch", `^${paymentSearchPattern(query)}`)
      .order("name", { ascending: true })
      .limit(4);
    if (error)
      throw new PageDataError("Zákazníky se nepodařilo vyhledat.", 500);
    return data ?? [];
  }
  let { data, error } = await identity.service.rpc("search_customers", {
    target_org: identity.membership.organization_id,
    actor_user: identity.user.id,
    search_query: query,
  });
  if (error?.code === "PGRST202" || error?.code === "42883") {
    const filter = legacyCustomerSearchFilter(query);
    if (!filter) return [];
    ({ data, error } = await identity.service
      .from("customers")
      .select("id, name, ico, dic, email")
      .eq("organization_id", identity.membership.organization_id)
      .or(filter)
      .order("name", { ascending: true })
      .limit(10));
  }
  if (error) throw new PageDataError("Zákazníky se nepodařilo vyhledat.", 500);
  return (data ?? []) as CustomerSearchResult[];
}
