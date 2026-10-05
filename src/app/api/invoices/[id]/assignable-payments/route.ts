import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { canManageInvoices } from "@/lib/role-access";
import { minorUnits } from "@/lib/money";
import type { AssignableBankPayment } from "@/lib/assignable-bank-payment";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 500;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "Neplatný identifikátor faktury." }, { status: 400 });

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění párovat bankovní platby." }, { status: 403 });

  const organizationId = identity.membership.organization_id;
  const { data: invoice, error: invoiceError } = await identity.service.from("invoices")
    .select("amount, paid_amount, currency, status")
    .eq("id", id).eq("organization_id", organizationId).maybeSingle();
  if (invoiceError) {
    logError("Fakturu se nepodařilo načíst", invoiceError);
    return apiError(request, "Fakturu se nepodařilo načíst.", 500, "assignable_payments_invoice_read_failed");
  }
  if (!invoice || !["pending", "overdue"].includes(invoice.status)) return NextResponse.json({ payments: [], remaining_amount: 0 }, { headers: { "cache-control": "private, no-store" } });

  const remaining = minorUnits(invoice.amount) - minorUnits(invoice.paid_amount);
  if (remaining <= 0) return NextResponse.json({ payments: [], remaining_amount: 0 }, { headers: { "cache-control": "private, no-store" } });
  const payments: AssignableBankPayment[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error: paymentsError } = await identity.service.from("bank_payments")
      .select("id, booked_on, amount, currency, variable_symbol, counterparty_name, match_status")
      .eq("organization_id", organizationId)
      .in("match_status", ["unmatched", "ambiguous"])
      .is("invoice_id", null)
      .order("booked_on", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (paymentsError) {
      logError("Platby se nepodařilo načíst", paymentsError);
      return apiError(request, "Platby se nepodařilo načíst.", 500, "assignable_payments_read_failed");
    }
    for (const payment of data ?? []) {
      const amount = minorUnits(payment.amount);
      const sameCurrency = payment.currency === invoice.currency;
      payments.push({
        ...payment,
        match_status: payment.match_status as AssignableBankPayment["match_status"],
        amount: Number(payment.amount),
        recommended: sameCurrency && amount === remaining,
        unavailable_reason: !sameCurrency
          ? "Jiná měna než na faktuře"
          : amount > remaining ? "Částka převyšuje zbývající úhradu" : null,
      });
    }
    if (!data || data.length < PAGE_SIZE) break;
  }
  payments.sort((a, b) => Number(b.recommended) - Number(a.recommended));
  return NextResponse.json(
    { payments, remaining_amount: remaining / 100 },
    { headers: { "cache-control": "private, no-store" } },
  );
}
