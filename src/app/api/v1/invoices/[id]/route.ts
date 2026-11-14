import { publicApi, apiQueryError, apiNotFound, apiResourceId } from "@/lib/public-api";
import { invoiceApiResponse, PUBLIC_INVOICE_FIELDS } from "@/lib/public-api-invoices";
import type { Invoice } from "@/types/invoice";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return publicApi(request, "invoices:read", async identity => {
    const id = apiResourceId((await params).id);
    const { data, error } = await identity.service.from("invoices").select(PUBLIC_INVOICE_FIELDS).eq("organization_id", identity.organizationId).eq("id", id).maybeSingle();
    apiQueryError(error); if (!data) apiNotFound("Doklad");
    return Response.json({ invoice: invoiceApiResponse(data as unknown as Invoice) });
  });
}
