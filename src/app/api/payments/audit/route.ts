import { NextResponse } from "next/server";
import { getRequestIdentity, canManageInvoices } from "@/lib/auth";

export async function GET() {
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášeni." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění ke kontrole úhrad." }, { status: 403 });
  const { data, error } = await identity.service.rpc("audit_invoice_money", { target_org: identity.membership.organization_id });
  if (error) return NextResponse.json({ error: "Kontrolu částek se nepodařilo provést." }, { status: 500 });
  return NextResponse.json({ discrepancies: data, note: "Pouze kontrola. Žádné částky nebyly změněny. Chybějící původní OCR součty nejsou odhadovány." }, { headers: { "cache-control": "no-store" } });
}
