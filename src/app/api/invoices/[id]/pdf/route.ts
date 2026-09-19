import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { canViewFinancialInsights } from "@/lib/role-access";
import { generateInvoicePdf, invoicePdfFilename, invoicePdfResponse } from "@/lib/invoice-pdf";
import type { Invoice } from "@/types/invoice";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Context) {
  const { id } = await params;
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canViewFinancialInsights(identity.membership.role)) {
    return NextResponse.json({ error: "Nemáte oprávnění fakturu zobrazit." }, { status: 403 });
  }

  const organizationId = identity.membership.organization_id;
  const { data: invoice, error: invoiceError } = await identity.service.from("invoices").select("*")
    .eq("id", id).eq("organization_id", organizationId).maybeSingle();
  if (invoiceError) return NextResponse.json({ error: "Fakturu se nepodařilo načíst." }, { status: 500 });
  if (!invoice) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });

  const { data: company, error: companyError } = await identity.service.from("organizations")
    .select("name, ico, dic, registered_address, operating_address, phone, email, bank_account_czk, bank_account_eur")
    .eq("id", organizationId).maybeSingle();
  if (companyError || !company) return NextResponse.json({ error: "Firemní údaje se nepodařilo načíst." }, { status: 500 });

  const bytes = await generateInvoicePdf(invoice as Invoice, company);
  return invoicePdfResponse(bytes, invoicePdfFilename(invoice as Invoice));
}
