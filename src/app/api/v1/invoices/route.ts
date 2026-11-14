import { publicApi, readApiJson, apiQueryError, apiRequireScope } from "@/lib/public-api";
import { apiCreationDraft, invoiceApiResponse, PUBLIC_INVOICE_FIELDS } from "@/lib/public-api-invoices";
import { invoiceApiBody, apiIdempotencyKey, apiOperationId, apiPage, encodeApiCursor, stableApiHash, PublicApiError } from "@/lib/public-api-input";
import { issueCreation } from "@/lib/invoice-issue-server";
import type { Invoice } from "@/types/invoice";

export async function GET(request: Request) {
  return publicApi(request, "invoices:read", async identity => {
    const url = new URL(request.url), { limit, cursor } = apiPage(url);
    let query = identity.service.from("invoices").select(PUBLIC_INVOICE_FIELDS).eq("organization_id", identity.organizationId).order("created_at").order("id").limit(limit + 1);
    if (cursor) query = query.or(`created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`);
    const status = url.searchParams.get("status");
    if (status) {
      if (!["pending", "overdue", "paid", "cancelled"].includes(status)) throw new PublicApiError("Neplatný stav faktury.");
      query = query.eq("status", status as Invoice["status"]);
    }
    const variableSymbol = url.searchParams.get("variable_symbol");
    if (variableSymbol) {
      if (!/^\d{1,10}$/.test(variableSymbol)) throw new PublicApiError("Neplatný variabilní symbol.");
      query = query.eq("variable_symbol", variableSymbol);
    }
    const { data, error } = await query; apiQueryError(error);
    const rows = (data ?? []) as unknown as Invoice[], page = rows.slice(0, limit);
    return Response.json({ data: page.map(invoiceApiResponse), has_more: rows.length > limit, next_cursor: rows.length > limit ? encodeApiCursor(page[page.length - 1]) : null });
  });
}
export async function POST(request: Request) {
  return publicApi(request, "invoices:write", async identity => {
    const body = invoiceApiBody(await readApiJson(request));
    if (body.paid_amount > 0) apiRequireScope(identity, "payments:write");
    const key = apiIdempotencyKey(request, body.request_id);
    const id = apiOperationId(identity.organizationId, "invoices", key);
    const result = await issueCreation(identity, apiCreationDraft(body, id), { autoNumber: true, defaultPaymentAccount: true, paidAmount: body.paid_amount, expectedTotal: body.expected_total, requestHash: stableApiHash({ ...body, request_id: "" }) });
    if (result.refresh_required) throw new PublicApiError("Faktura byla vytvořena, ale aktuální stav úhrady se nepodařilo načíst. Zopakujte stejný požadavek se stejným Idempotency-Key.", 503, "invoice_refresh_required", { invoice_id: result.invoice.id });
    return Response.json({ invoice: invoiceApiResponse(result.invoice), replayed: result.replayed }, { status: result.replayed ? 200 : 201 });
  });
}
