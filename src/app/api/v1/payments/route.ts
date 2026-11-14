import { publicApi, apiQueryError, apiResourceId } from "@/lib/public-api";
import { apiPage, encodeApiCursor, PublicApiError } from "@/lib/public-api-input";
type ApiPayment = { id: string; created_at: string; amount: number; allocated_amount: number; unallocated_amount: number; allocations: { invoice_id: string; amount: number }[]; [field: string]: unknown };
export async function GET(request: Request) {
  return publicApi(request, "payments:read", async identity => {
    const url = new URL(request.url), { limit, cursor } = apiPage(url);
    const invoiceId = url.searchParams.get("invoice_id");
    const { data, error } = await identity.service.rpc("list_api_payments_page", {
      target_org: identity.organizationId, actor_user: identity.actingUserId,
      ...(invoiceId ? { target_invoice: apiResourceId(invoiceId) } : {}),
      ...(cursor ? { cursor_time: cursor.created_at, cursor_id: cursor.id } : {}), page_size: limit,
    });
    if (error?.code === "42501") throw new PublicApiError("Integrace už nemá oprávnění číst platby.", 403, "insufficient_scope");
    apiQueryError(error);
    const rows = (data ?? []) as unknown as ApiPayment[], page = rows.slice(0, limit);
    return Response.json({ data: page.map(payment => ({ ...payment,
      amount: Number(payment.amount).toFixed(2), allocated_amount: Number(payment.allocated_amount).toFixed(2), unallocated_amount: Number(payment.unallocated_amount).toFixed(2),
      allocations: (payment.allocations ?? []).map(allocation => ({ invoice_id: allocation.invoice_id, amount: Number(allocation.amount).toFixed(2) })),
    })), has_more: rows.length > limit, next_cursor: rows.length > limit ? encodeApiCursor(page[page.length - 1]) : null });
  });
}
