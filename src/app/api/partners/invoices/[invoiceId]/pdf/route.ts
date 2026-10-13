import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getRequestIdentity } from "@/lib/auth";
import { generateInvoicePdf, invoicePdfFilename, invoicePdfResponse, type InvoicePdfCompany } from "@/lib/invoice-pdf";
import { canViewNetwork } from "@/lib/role-access";
import { logError } from "@/lib/structured-log";
import type { Invoice } from "@/types/invoice";

type Context = { params: Promise<{ invoiceId: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PDF faktury, kterou nám vystavil propojený partner. Data i firma vystavitele
// jdou z network_partner_invoice, která ověří aktivní propojení a rozsah
// sdílení; vlastní firemní údaje čtenáře se do PDF nikdy nedostanou.
export async function GET(request: Request, { params }: Context) {
  const { invoiceId } = await params;
  if (!UUID_RE.test(invoiceId)) return NextResponse.json({ error: "Neplatný identifikátor faktury." }, { status: 400 });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canViewNetwork(identity.membership.role)) {
    return NextResponse.json({ error: "Nemáte oprávnění fakturu zobrazit." }, { status: 403 });
  }
  const { data, error } = await identity.service.rpc("network_partner_invoice", {
    target_org: identity.membership.organization_id, actor_user: identity.user.id, target_invoice: invoiceId,
  });
  if (error) {
    logError("Fakturu partnera pro PDF se nepodařilo načíst", error, { invoice_id: invoiceId });
    return apiError(request, "Fakturu se nepodařilo načíst.", 500, "partner_invoice_read_failed");
  }
  const shared = data as { invoice: Invoice; issuer: InvoicePdfCompany } | null;
  if (!shared?.invoice || !shared.issuer) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });
  const bytes = await generateInvoicePdf(shared.invoice, shared.issuer);
  return invoicePdfResponse(bytes, invoicePdfFilename(shared.invoice));
}
