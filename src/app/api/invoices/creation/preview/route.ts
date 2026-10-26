import { apiError } from "@/lib/api-response";
import { logError, requestId } from "@/lib/structured-log";
import { InvoiceCreationError } from "@/lib/invoice-creation";
import { NextResponse } from "next/server";
import { getRequestIdentity, canManageInvoices } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import {
  CREATION_COMPANY_FIELDS,
  creationSupplier,
  prepareCreation,
} from "@/lib/invoice-creation-server";
import { generateIssuedInvoicePdf } from "@/lib/issued-invoice-pdf";
import { invoicePdfResponse } from "@/lib/invoice-pdf";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Nepovolený původ požadavku." },
      { status: 403 },
    );
  const identity = await getRequestIdentity();
  if (!identity)
    return NextResponse.json({ error: "Nejste přihlášeni." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role))
    return NextResponse.json(
      { error: "Nemáte oprávnění vystavovat faktury." },
      { status: 403 },
    );
  const body = await request.json().catch(() => null);
  const company = await identity.service
    .from("organizations")
    .select(CREATION_COMPANY_FIELDS)
    .eq("id", identity.membership.organization_id)
    .single();
  if (company.error || !company.data) {
    logError("Firemní údaje pro náhled se nepodařilo načíst", company.error, { request_id: requestId(request) });
    return apiError(request, "Firemní údaje se nepodařilo načíst.", 503, "company_read_failed");
  }
  try {
    const { document } = await prepareCreation(
      body?.creation,
      creationSupplier(company.data),
      identity,
    );
    const bytes = await generateIssuedInvoicePdf({
      ...document,
      invoice_number: `KONCEPT · ${document.invoice_number}`,
    });
    return invoicePdfResponse(bytes, "Koncept-faktury.pdf");
  } catch (cause) {
    if (cause instanceof InvoiceCreationError && cause.status < 500) return NextResponse.json({ error: cause.message }, { status: cause.status });
    logError("Náhled faktury se nepodařilo připravit", cause, { request_id: requestId(request) });
    return apiError(request, "Náhled PDF se nepodařilo připravit. Zkuste to později.", 503, "invoice_preview_failed");
  }
}
