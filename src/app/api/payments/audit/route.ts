import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { getRequestIdentity, canManageInvoices } from "@/lib/auth";

export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášeni." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění ke kontrole úhrad." }, { status: 403 });
  const { data, error } = await identity.service.rpc("audit_invoice_money", { target_org: identity.membership.organization_id });
  if (error) {
    logError("Kontrolu částek se nepodařilo provést", error);
    return apiError(request, "Kontrolu částek se nepodařilo provést.", 500, "money_audit_failed");
  }
  return NextResponse.json({ discrepancies: data, note: "Pouze kontrola. Žádné částky nebyly změněny. Chybějící původní OCR součty nejsou odhadovány." }, { headers: { "cache-control": "no-store" } });
}
