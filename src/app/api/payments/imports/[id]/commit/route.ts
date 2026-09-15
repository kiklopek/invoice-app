import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { canUseGpcImport } from "@/lib/gpc-feature";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    acknowledge_account_mismatch?: unknown;
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
      { error: "Nemáte oprávnění potvrdit import." },
      { status: 403 },
    );
  const { data, error } = await identity.service.rpc(
    "commit_bank_statement_import",
    {
      target_org: identity.membership.organization_id,
      actor_user: identity.user.id,
      target_import: id,
      expected_revision: Number(body?.revision),
      acknowledge_account_mismatch: body?.acknowledge_account_mismatch === true,
    },
  );
  if (error) {
    const conflict = /revision_conflict|not_committable/.test(error.message);
    const mismatch = error.message.includes(
      "account_mismatch_acknowledgement_required",
    );
    return NextResponse.json(
      {
        error: conflict
          ? "Import mezitím změnil jiný uživatel. Načtěte jej znovu."
          : mismatch
            ? "Potvrďte nesoulad bankovního účtu."
            : "Import nelze bezpečně potvrdit. Žádná změna nebyla zaúčtována.",
      },
      { status: conflict ? 409 : 400 },
    );
  }
  return NextResponse.json(data);
}
