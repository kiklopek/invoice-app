import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { canUseGpcImport } from "@/lib/gpc-feature";
import { reconciliationError } from "@/lib/reconciliation-errors";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Zahození je měkké: výpis dostane stav 'discarded' a zůstane v archivu.
// Tvrdé smazání by kaskádou odstranilo položky výpisu, ale už zaúčtované
// platby by přežily bez vazby na svůj původ -- tedy bez auditní stopy.
// Funkce v databázi navíc zahození odmítne, pokud z výpisu nějaká platba
// vznikla; tahle routa to jen tlumočí uživateli.
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
    revision?: unknown;
    reason?: unknown;
  } | null;
  if (!uuid.test(id) || !Number.isInteger(body?.revision))
    return NextResponse.json(
      { error: "Neplatný import nebo revize." },
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
      { error: "Nemáte oprávnění zahodit import." },
      { status: 403 },
    );
  const { data, error } = await identity.service.rpc(
    "discard_bank_statement_import",
    {
      target_org: identity.membership.organization_id,
      actor_user: identity.user.id,
      target_import: id,
      expected_revision: Number(body?.revision),
      reason: typeof body?.reason === "string" ? body.reason.slice(0, 500) : null,
    },
  );
  if (error) {
    // Konflikt revize a nevhodný stav jsou 409 -- uživatel má načíst aktuální
    // stav, ne opakovat tentýž požadavek. Zaúčtované platby jsou 409 také:
    // je to konflikt se skutečností, ne špatně sestavený požadavek.
    const conflict = /revision_conflict|not_discardable|has_booked_payments/.test(error.message);
    return NextResponse.json(reconciliationError(error.message), { status: conflict ? 409 : 400 });
  }
  return NextResponse.json(data);
}
