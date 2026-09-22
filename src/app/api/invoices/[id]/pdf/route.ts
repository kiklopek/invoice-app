import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { getRequestIdentity } from "@/lib/auth";
import { canViewFinancialInsights } from "@/lib/role-access";
import { generateInvoicePdf, invoicePdfFilename, invoicePdfResponse } from "@/lib/invoice-pdf";
import type { Invoice } from "@/types/invoice";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canViewFinancialInsights(identity.membership.role)) {
    return NextResponse.json({ error: "Nemáte oprávnění fakturu zobrazit." }, { status: 403 });
  }

  const organizationId = identity.membership.organization_id;
  const { data: invoice, error: invoiceError } = await identity.service.from("invoices").select("*")
    .eq("id", id).eq("organization_id", organizationId).maybeSingle();
  if (invoiceError) {
    logError("Fakturu pro PDF se nepodařilo načíst", invoiceError, { invoice_id: id });
    return apiError(request, "Fakturu se nepodařilo načíst.", 500, "invoice_read_failed");
  }
  if (!invoice) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });

  const { data: company, error: companyError } = await identity.service.from("organizations")
    .select("name, ico, dic, registered_address, operating_address, phone, email, bank_account_czk, bank_account_eur")
    .eq("id", organizationId).maybeSingle();
  if (companyError || !company) {
    logError("Firemní údaje pro PDF se nepodařilo načíst", companyError, { invoice_id: id });
    return apiError(request, "Firemní údaje se nepodařilo načíst.", 500, "company_read_failed");
  }

  const bytes = await generateInvoicePdf(invoice as Invoice, company);
  return invoicePdfResponse(bytes, invoicePdfFilename(invoice as Invoice));
}
