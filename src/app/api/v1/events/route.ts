import { publicApi, apiQueryError, apiResourceId } from "@/lib/public-api";
import { apiPage, encodeApiCursor, PublicApiError } from "@/lib/public-api-input";
import { INVOICE_EVENT_TYPES } from "@/types/invoice";
export async function GET(request: Request) {
  return publicApi(request, "events:read", async identity => {
    const url = new URL(request.url), { limit, cursor } = apiPage(url);
    let query = identity.service.from("invoice_events").select("id,invoice_id,event_type,created_at").eq("organization_id", identity.organizationId).order("created_at").order("id").limit(limit + 1);
    if (cursor) query = query.or(`created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`);
    const invoiceId = url.searchParams.get("invoice_id");
    if (invoiceId) query = query.eq("invoice_id", apiResourceId(invoiceId));
    const type = url.searchParams.get("type");
    if (type) {
      if (!(INVOICE_EVENT_TYPES as readonly string[]).includes(type)) throw new PublicApiError("Nepodporovaný typ události.");
      query = query.eq("event_type", type);
    }
    const { data, error } = await query; apiQueryError(error);
    const page = (data ?? []).slice(0, limit);
    return Response.json({ data: page.map(event => ({ id: event.id, type: `invoice.${event.event_type}`, invoice_id: event.invoice_id, created_at: event.created_at })), has_more: (data?.length ?? 0) > limit,
      next_cursor: page.length ? encodeApiCursor(page[page.length - 1]) : url.searchParams.get("cursor") });
  });
}
