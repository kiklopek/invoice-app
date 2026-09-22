import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { loadPaymentsPageData } from "@/lib/payments-page-data";
import { PageDataError } from "@/lib/dashboard-page-data";

export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  try {
    const data = await loadPaymentsPageData(identity);
    return NextResponse.json(data);
  } catch (cause) {
    if (cause instanceof PageDataError) return NextResponse.json({ error: cause.message }, { status: cause.status });
    logError("Bankovní platby se nepodařilo načíst", cause);
    return apiError(request, "Bankovní platby se nepodařilo načíst. Zkuste to prosím znovu za chvíli.", 500, "bank_payments_read_failed");
  }
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
          "Platbu se nepodařilo bezpečně uvolnit. Zkontrolujte její stav a zkuste to znovu.",
      },
      { status: 409 },
    );
  // unassign_bank_payment_allocations already recomputes next_reminder_at per
  // released invoice inside the same transaction; no follow-up query needed here.
  return NextResponse.json(data);
}
