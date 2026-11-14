import { publicApi, apiQueryError, apiNotFound, apiResourceId } from "@/lib/public-api";
import { generateInvoicePdf, invoicePdfFilename, invoicePdfResponse } from "@/lib/invoice-pdf";
import type { Invoice } from "@/types/invoice";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return publicApi(request, "invoices:read", async identity => {
    const id = apiResourceId((await params).id);
    const { data, error } = await identity.service.from("invoices").select("*").eq("organization_id", identity.organizationId).eq("id", id).maybeSingle();
    apiQueryError(error); if (!data) apiNotFound("Doklad");
    const company = await identity.service.from("organizations").select("name, ico, dic, registered_address, operating_address, phone, email, bank_account_czk, bank_account_eur, vat_payer, bank_accounts:organization_bank_accounts(account, currency)").eq("id", identity.organizationId).single();
    apiQueryError(company.error); if (!company.data) apiNotFound("Firma");
    const invoice = data as Invoice;
    return invoicePdfResponse(await generateInvoicePdf(invoice, company.data), invoicePdfFilename(invoice));
  });
}
