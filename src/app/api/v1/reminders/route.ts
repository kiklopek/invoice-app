import { publicApi, apiQueryError, apiResourceId } from "@/lib/public-api";
import { apiPage, encodeApiCursor } from "@/lib/public-api-input";
export async function GET(request: Request) {
  return publicApi(request, "reminders:read", async identity => {
    const url = new URL(request.url), { limit, cursor } = apiPage(url);
    let query = identity.service.from("reminder_log").select("id,invoice_id,stage,status,scheduled_for,sent_at,delivery_status,delivered_at,attempt_count,created_at,updated_at").eq("organization_id", identity.organizationId).order("created_at").order("id").limit(limit + 1);
    if (cursor) query = query.or(`created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`);
    const invoiceId = url.searchParams.get("invoice_id");
    if (invoiceId) query = query.eq("invoice_id", apiResourceId(invoiceId));
    const { data, error } = await query; apiQueryError(error);
    const page = (data ?? []).slice(0, limit);
    return Response.json({ data: page, has_more: (data?.length ?? 0) > limit, next_cursor: (data?.length ?? 0) > limit ? encodeApiCursor(page[page.length - 1]) : null });
  });
}
