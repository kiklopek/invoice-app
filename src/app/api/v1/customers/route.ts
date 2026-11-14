import { publicApi, readApiJson, apiQueryError } from "@/lib/public-api";
import { customerApiBody, apiIdempotencyKey, apiOperationId, apiPage, encodeApiCursor, stableApiHash, PublicApiError } from "@/lib/public-api-input";
import { customerApiResponse, PUBLIC_CUSTOMER_FIELDS, type PublicCustomer } from "@/lib/public-api-customers";

export async function GET(request: Request) {
  return publicApi(request, "customers:read", async identity => {
    const { limit, cursor } = apiPage(new URL(request.url));
    let query = identity.service.from("customers").select(PUBLIC_CUSTOMER_FIELDS)
      .eq("organization_id", identity.organizationId).order("created_at").order("id").limit(limit+1);
    if (cursor) query = query.or(`created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`);
    const { data, error } = await query; apiQueryError(error);
    const rows = (data ?? []) as PublicCustomer[], page = rows.slice(0,limit);
    return Response.json({ data: page.map(customerApiResponse), has_more: rows.length>limit,
      next_cursor: rows.length>limit ? encodeApiCursor(page[page.length-1]) : null });
  });
}
export async function POST(request: Request) {
  return publicApi(request, "customers:write", async identity => {
    const body = customerApiBody(await readApiJson(request));
    const key = apiIdempotencyKey(request);
    // Localized RPC interface until generated database types include this migration.
    const service = identity.service as unknown as {
      rpc(name: "create_api_customer", args: { target_org: string; actor_user: string; request_uuid: string; payload_hash: string; customer_payload: typeof body }):
        Promise<{ data: { customer: PublicCustomer; replayed: boolean } | null; error: { code?: string; message?: string } | null }>;
    };
    const { data, error } = await service.rpc("create_api_customer", {
      target_org: identity.organizationId, actor_user: identity.actingUserId,
      request_uuid: apiOperationId(identity.organizationId, "customers", key), payload_hash: stableApiHash(body), customer_payload: body,
    });
    if (error?.code === "P0001" && error.message === "API_IDEMPOTENCY_CONFLICT") throw new PublicApiError("Idempotency-Key už byl použitý pro jiný obsah.",409,"idempotency_conflict");
    if (error?.code === "23505") throw new PublicApiError("Zákazník s tímto IČO už existuje. Použijte jeho identifikátor.",409,"customer_conflict");
    if (error?.code === "42501") throw new PublicApiError("Oprávnění autora API klíče už není platné.",403,"insufficient_scope");
    if (error?.code === "22023") throw new PublicApiError("Zkontrolujte údaje zákazníka. Odběratel se nesmí shodovat s vystavitelem.");
    apiQueryError(error); if (!data?.customer) apiQueryError(true);
    return Response.json({ customer: customerApiResponse(data!.customer), replayed: data!.replayed }, { status: data!.replayed ? 200 : 201 });
  });
}
