import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { canManageInvoices } from "@/lib/role-access";
import { minorUnits } from "@/lib/money";
import type { AssignableBankPayment } from "@/lib/assignable-bank-payment";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "Neplatný identifikátor faktury." }, { status: 400 });

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění párovat bankovní platby." }, { status: 403 });

  const organizationId = identity.membership.organization_id;
  const { data: invoice, error: invoiceError } = await identity.service.from("invoices")
    .select("amount, paid_amount, currency, status")
    .eq("id", id).eq("organization_id", organizationId).maybeSingle();
  if (invoiceError) return NextResponse.json({ error: "Fakturu se nepodařilo načíst." }, { status: 500 });
  if (!invoice || !["pending", "overdue"].includes(invoice.status)) return NextResponse.json({ payments: [] }, { headers: { "cache-control": "private, no-store" } });

  const remaining = (minorUnits(Number(invoice.amount)) - minorUnits(Number(invoice.paid_amount))) / 100;
  if (remaining <= 0) return NextResponse.json({ payments: [] }, { headers: { "cache-control": "private, no-store" } });
  const { data, error } = await identity.service.from("bank_payments")
    .select("id, booked_on, amount, currency, variable_symbol, counterparty_name, match_status")
    .eq("organization_id", organizationId)
    .in("match_status", ["unmatched", "ambiguous"])
    .eq("currency", invoice.currency)
    .eq("amount", remaining)
    .order("booked_on", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: "Vhodné bankovní platby se nepodařilo načíst." }, { status: 500 });
  return NextResponse.json(
    { payments: (data ?? []).map((payment) => ({ ...payment, amount: Number(payment.amount) })) as AssignableBankPayment[] },
    { headers: { "cache-control": "private, no-store" } },
  );
}
