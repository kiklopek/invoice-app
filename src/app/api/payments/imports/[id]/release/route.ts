import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { canUseGpcImport } from "@/lib/gpc-feature";
import { reconciliationError } from "@/lib/reconciliation-errors";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Take back one statement row that was booked, so it can be assigned by hand.
 *
 * Reverses the invoice balances, removes the payment record entirely (while it
 * exists the row cannot be re-booked -- its external_id reads as a duplicate)
 * and pins the row to manual review, so the unattended pass does not simply
 * re-book what the user just took back.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Požadavek pochází z nepovoleného webu." },
      { status: 403 },
    );
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    entry_id?: unknown;
  } | null;
  const entryId = typeof body?.entry_id === "string" ? body.entry_id.trim() : "";
  if (!uuid.test(id) || !uuid.test(entryId))
    return NextResponse.json(
      { error: "Neplatný import nebo položka." },
      { status: 400 },
    );
  const identity = await getRequestIdentity();
  if (!identity)
    return NextResponse.json(
      { error: "Nejste přihlášený uživatel." },
      { status: 401 },
    );
  if (
    !canManageInvoices(identity.membership.role) ||
    !canUseGpcImport(identity.membership.role)
  )
    return NextResponse.json(
      { error: "Nemáte oprávnění měnit zaúčtované platby." },
      { status: 403 },
    );

  const { data, error } = await identity.service.rpc("release_statement_entry", {
    target_org: identity.membership.organization_id,
    actor_user: identity.user.id,
    target_entry: entryId,
  });
  if (error)
    return NextResponse.json(reconciliationError(error.message), {
      status: /not_found|not_booked/.test(error.message) ? 409 : 400,
    });
  return NextResponse.json(data);
}
