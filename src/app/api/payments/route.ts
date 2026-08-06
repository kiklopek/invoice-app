import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { demoInvoices } from "@/lib/demo-data";
import { validatePaymentRows } from "@/lib/payment-import";
import { isSameOriginMutation } from "@/lib/request-security";
import { isDemoMode } from "@/lib/supabase-server";

type ImportResult = {
  external_id: string;
  status: "matched" | "unmatched" | "ambiguous" | "duplicate";
  invoice_id?: string;
  invoice_number?: string;
  settlement?: "full" | "partial";
  remaining?: number;
};

export async function GET() {
  if (isDemoMode()) return NextResponse.json({
    payments: [{
      id: "demo-payment-unmatched", external_id: "BANK-DEMO-002", booked_on: "2026-08-06",
      amount: 96750, currency: "CZK", variable_symbol: null, counterparty_name: "Dřevostavby Morava a.s.",
      match_status: "unmatched", invoice_id: null, invoices: null,
    }],
    open_invoices: demoInvoices.filter(invoice => ["pending", "overdue"].includes(invoice.status)).map(invoice => ({
      id: invoice.id, invoice_number: invoice.invoice_number, counterparty_name: invoice.counterparty_name,
      amount: invoice.amount, paid_amount: invoice.paid_amount, currency: invoice.currency, variable_symbol: invoice.variable_symbol,
    })),
    can_manage: true,
  });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });

  const [{ data, error }, { data: openInvoices, error: invoiceError }] = await Promise.all([
    identity.service.from("bank_payments")
      .select("id, external_id, booked_on, amount, currency, variable_symbol, counterparty_name, match_status, invoice_id, invoices(invoice_number, counterparty_name)")
      .eq("organization_id", identity.membership.organization_id).order("booked_on", { ascending: false }).limit(100),
    identity.service.from("invoices")
      .select("id, invoice_number, counterparty_name, amount, paid_amount, currency, variable_symbol")
      .eq("organization_id", identity.membership.organization_id).in("status", ["pending", "overdue"])
      .order("due_date", { ascending: true }).limit(500),
  ]);
  if (error || invoiceError) return NextResponse.json({ error: "Bankovní platby se nepodařilo načíst. Zkontrolujte poslední databázovou migraci." }, { status: 500 });
  return NextResponse.json({ payments: data ?? [], open_invoices: openInvoices ?? [], can_manage: canManageInvoices(identity.membership.role) });
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { payments?: unknown } | null;
  const payments = validatePaymentRows(body?.payments);
  if (!payments) return NextResponse.json({ error: "Import obsahuje neplatné údaje, duplicity nebo více než 500 plateb." }, { status: 400 });

  if (isDemoMode()) {
    const results: ImportResult[] = payments.map(payment => {
      const candidates = demoInvoices.filter(invoice =>
        ["pending", "overdue"].includes(invoice.status) &&
        Boolean(payment.variable_symbol) && invoice.variable_symbol === payment.variable_symbol &&
        invoice.currency === payment.currency && payment.amount <= Number(invoice.amount) - Number(invoice.paid_amount)
      );
      if (candidates.length === 1) { const remaining = Number(candidates[0].amount) - Number(candidates[0].paid_amount) - payment.amount; return { external_id: payment.external_id, status: "matched", invoice_id: candidates[0].id, invoice_number: candidates[0].invoice_number, settlement: remaining === 0 ? "full" : "partial", remaining }; }
      return { external_id: payment.external_id, status: candidates.length > 1 ? "ambiguous" : "unmatched" };
    });
    return NextResponse.json({
      imported: payments.length,
      matched: results.filter(item => item.status === "matched").length,
      partial_matched: results.filter(item => item.settlement === "partial").length,
      unmatched: results.filter(item => item.status === "unmatched").length,
      ambiguous: results.filter(item => item.status === "ambiguous").length,
      duplicates: 0,
      results,
    }, { status: 201 });
  }

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění importovat bankovní platby." }, { status: 403 });

  const { data, error } = await identity.service.rpc("import_and_reconcile_bank_payments", {
    target_org: identity.membership.organization_id,
    actor_user: identity.user.id,
    payment_rows: payments,
  });
  if (error) return NextResponse.json({ error: "Platby se nepodařilo bezpečně importovat. Zkontrolujte formát a databázovou migraci." }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { payment_id?: unknown; invoice_id?: unknown } | null;
  const paymentId = typeof body?.payment_id === "string" ? body.payment_id.trim() : "";
  const invoiceId = typeof body?.invoice_id === "string" ? body.invoice_id.trim() : "";
  if (!paymentId || paymentId.length > 64 || !invoiceId || invoiceId.length > 64) {
    return NextResponse.json({ error: "Vyberte platbu a fakturu." }, { status: 400 });
  }

  if (isDemoMode()) {
    const invoice = demoInvoices.find(item => item.id === invoiceId && ["pending", "overdue"].includes(item.status));
    const remaining = invoice ? Number(invoice.amount) - Number(invoice.paid_amount) : 0;
    if (!invoice || paymentId !== "demo-payment-unmatched" || 96750 > remaining || invoice.currency !== "CZK") {
      return NextResponse.json({ error: "Platba musí mít stejnou měnu a nesmí překročit zbývající částku faktury." }, { status: 409 });
    }
    return NextResponse.json({ payment_id: paymentId, invoice_id: invoice.id, invoice_number: invoice.invoice_number, status: "matched", settlement: 96750 === remaining ? "full" : "partial", paid_amount: Number(invoice.paid_amount) + 96750, remaining: remaining - 96750, invoice_status: 96750 === remaining ? "paid" : invoice.status });
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId)) {
    return NextResponse.json({ error: "Neplatný identifikátor platby nebo faktury." }, { status: 400 });
  }
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění párovat bankovní platby." }, { status: 403 });
  const { data, error } = await identity.service.rpc("assign_bank_payment", {
    target_org: identity.membership.organization_id,
    target_payment: paymentId,
    target_invoice: invoiceId,
    actor_user: identity.user.id,
  });
  if (error) return NextResponse.json({ error: "Platbu nelze přiřadit. Musí být dosud nespárovaná, mít stejnou měnu a nepřekročit zbývající částku faktury." }, { status: 409 });
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { payment_id?: unknown } | null;
  const paymentId = typeof body?.payment_id === "string" ? body.payment_id.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentId)) {
    if (isDemoMode() && paymentId.startsWith("demo-")) return NextResponse.json({ payment_id: paymentId, status: "unmatched", invoice_status: "pending", paid_amount: 0, remaining: 96750 });
    return NextResponse.json({ error: "Neplatný identifikátor platby." }, { status: 400 });
  }
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění uvolnit bankovní platbu." }, { status: 403 });
  const { data, error } = await identity.service.rpc("unassign_bank_payment", {
    target_org: identity.membership.organization_id,
    target_payment: paymentId,
    actor_user: identity.user.id,
  });
  if (error) return NextResponse.json({ error: "Platbu se nepodařilo bezpečně uvolnit. Zkontrolujte její stav a databázovou migraci." }, { status: 409 });
  return NextResponse.json(data);
}
