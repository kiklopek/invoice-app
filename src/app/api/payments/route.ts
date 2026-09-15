import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { canAccessOperations } from "@/lib/role-access";
import { isSameOriginMutation } from "@/lib/request-security";
import { canUseGpcImport } from "@/lib/gpc-feature";

export async function GET() {
  const identity = await getRequestIdentity();
  if (!identity)
    return NextResponse.json(
      { error: "Nejste přihlášený uživatel." },
      { status: 401 },
    );
  if (!canAccessOperations(identity.membership.role))
    return NextResponse.json(
      { error: "Čtenář nemá přístup ke správě bankovních plateb." },
      { status: 403 },
    );

  const [{ data, error }, { data: openInvoices, error: invoiceError }] =
    await Promise.all([
      identity.service
        .from("bank_payments")
        .select(
          "id, external_id, booked_on, amount, currency, variable_symbol, counterparty_name, match_status, source, invoice_id, invoices!bank_payments_invoice_id_fkey(invoice_number, counterparty_name)",
        )
        .eq("organization_id", identity.membership.organization_id)
        .order("booked_on", { ascending: false })
        .limit(100),
      identity.service
        .from("invoices")
        .select(
          "id, invoice_number, counterparty_name, amount, paid_amount, currency, variable_symbol",
        )
        .eq("organization_id", identity.membership.organization_id)
        .in("status", ["pending", "overdue"])
        .order("due_date", { ascending: true })
        .limit(500),
    ]);
  if (error || invoiceError)
    return NextResponse.json(
      {
        error:
          "Bankovní platby se nepodařilo načíst. Zkontrolujte poslední databázovou migraci.",
      },
      { status: 500 },
    );
  const paymentIds = (data ?? []).map((payment) => payment.id);
  const { data: allocations } = paymentIds.length
    ? await identity.service
        .from("bank_payment_allocations")
        .select("bank_payment_id, invoice_id, amount")
        .eq("organization_id", identity.membership.organization_id)
        .eq("is_committed", true)
        .in("bank_payment_id", paymentIds)
    : { data: [] };
  const allocationInvoiceIds = [
    ...new Set((allocations ?? []).map((allocation) => allocation.invoice_id)),
  ];
  const { data: allocationInvoices } = allocationInvoiceIds.length
    ? await identity.service
        .from("invoices")
        .select("id, invoice_number, counterparty_name")
        .eq("organization_id", identity.membership.organization_id)
        .in("id", allocationInvoiceIds)
    : { data: [] };
  const invoiceById = new Map(
    (allocationInvoices ?? []).map((invoice) => [invoice.id, invoice]),
  );
  const allocationsByPayment = new Map<
    string,
    Array<{
      invoice_id: string;
      amount: number;
      invoice_number: string;
      counterparty_name: string;
    }>
  >();
  for (const allocation of allocations ?? [])
    allocationsByPayment.set(allocation.bank_payment_id!, [
      ...(allocationsByPayment.get(allocation.bank_payment_id!) ?? []),
      {
        invoice_id: allocation.invoice_id,
        amount: Number(allocation.amount),
        invoice_number:
          invoiceById.get(allocation.invoice_id)?.invoice_number ?? "Faktura",
        counterparty_name:
          invoiceById.get(allocation.invoice_id)?.counterparty_name ?? "",
      },
    ]);
  return NextResponse.json({
    payments: (data ?? []).map((payment) => ({
      ...payment,
      allocations: allocationsByPayment.get(payment.id) ?? [],
    })),
    open_invoices: openInvoices ?? [],
    can_manage: canManageInvoices(identity.membership.role),
    gpc_enabled: canUseGpcImport(identity.membership.role),
    runtime_mode: "production-database",
  });
}

export async function PATCH(request: Request) {
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Požadavek pochází z nepovoleného webu." },
      { status: 403 },
    );
  const body = (await request.json().catch(() => null)) as {
    payment_id?: unknown;
    invoice_id?: unknown;
  } | null;
  const paymentId =
    typeof body?.payment_id === "string" ? body.payment_id.trim() : "";
  const invoiceId =
    typeof body?.invoice_id === "string" ? body.invoice_id.trim() : "";
  if (
    !paymentId ||
    paymentId.length > 64 ||
    !invoiceId ||
    invoiceId.length > 64
  ) {
    return NextResponse.json(
      { error: "Vyberte platbu a fakturu." },
      { status: 400 },
    );
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      paymentId,
    ) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      invoiceId,
    )
  ) {
    return NextResponse.json(
      { error: "Neplatný identifikátor platby nebo faktury." },
      { status: 400 },
    );
  }
  const identity = await getRequestIdentity();
  if (!identity)
    return NextResponse.json(
      { error: "Nejste přihlášený uživatel." },
      { status: 401 },
    );
  if (!canManageInvoices(identity.membership.role))
    return NextResponse.json(
      { error: "Nemáte oprávnění párovat bankovní platby." },
      { status: 403 },
    );
  const { data, error } = await identity.service.rpc("assign_bank_payment", {
    target_org: identity.membership.organization_id,
    target_payment: paymentId,
    target_invoice: invoiceId,
    actor_user: identity.user.id,
  });
  if (error)
    return NextResponse.json(
      {
        error:
          "Platbu nelze přiřadit. Musí být dosud nespárovaná, mít stejnou měnu a nepřekročit zbývající částku faktury.",
      },
      { status: 409 },
    );
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Požadavek pochází z nepovoleného webu." },
      { status: 403 },
    );
  const body = (await request.json().catch(() => null)) as {
    payment_id?: unknown;
  } | null;
  const paymentId =
    typeof body?.payment_id === "string" ? body.payment_id.trim() : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      paymentId,
    )
  ) {
    return NextResponse.json(
      { error: "Neplatný identifikátor platby." },
      { status: 400 },
    );
  }
  const identity = await getRequestIdentity();
  if (!identity)
    return NextResponse.json(
      { error: "Nejste přihlášený uživatel." },
      { status: 401 },
    );
  if (!canManageInvoices(identity.membership.role))
    return NextResponse.json(
      { error: "Nemáte oprávnění uvolnit bankovní platbu." },
      { status: 403 },
    );
  const { data, error } = await identity.service.rpc(
    "unassign_bank_payment_allocations",
    {
      target_org: identity.membership.organization_id,
      target_payment: paymentId,
      actor_user: identity.user.id,
    },
  );
  if (error)
    return NextResponse.json(
      {
        error:
          "Platbu se nepodařilo bezpečně uvolnit. Zkontrolujte její stav a databázovou migraci.",
      },
      { status: 409 },
    );
  // unassign_bank_payment_allocations already recomputes next_reminder_at per
  // released invoice inside the same transaction; no follow-up query needed here.
  return NextResponse.json(data);
}
