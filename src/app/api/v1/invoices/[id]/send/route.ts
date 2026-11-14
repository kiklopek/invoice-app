import { publicApi, readApiJson, apiResourceId } from "@/lib/public-api";
import { apiIdempotencyKey, apiObject, apiOperationId, PublicApiError } from "@/lib/public-api-input";
import { sendInvoiceEmail } from "@/lib/invoice-send-server";
import { requestId } from "@/lib/structured-log";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return publicApi(request, "invoices:send", async identity => {
    const id = apiResourceId((await params).id);
    const body = apiObject(await readApiJson(request), ["recipient_confirmed"]);
    if (body.recipient_confirmed !== true) throw new PublicApiError("Potvrďte odeslání faktury odběrateli polem recipient_confirmed: true.");
    const action = apiOperationId(identity.organizationId, `send:${id}`, apiIdempotencyKey(request));
    const headers = new Headers(request.headers); headers.set("x-idempotency-key", action);
    headers.set("x-request-id", requestId(request));
    const forwarded = new Request(request.url, { method: "POST", headers, body: JSON.stringify({ purpose: "issue", recipient_confirmed: true }) });
    return sendInvoiceEmail(forwarded, identity, id);
  });
}
