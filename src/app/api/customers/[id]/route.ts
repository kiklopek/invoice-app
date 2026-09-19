import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";

type Context = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only `phone` is editable here. `name`/`dic`/`email` are kept in sync from
// invoices automatically (see the remember_customer_from_invoice trigger) --
// letting a human edit them here would just get silently overwritten the
// next time an invoice is saved for that IČO, which would be more confusing
// than not offering the edit at all.
export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Neplatný identifikátor zákazníka." }, { status: 400 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Array.isArray(body) || !("phone" in body)) return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  if (body.phone !== null && typeof body.phone !== "string") return NextResponse.json({ error: "Neplatné telefonní číslo." }, { status: 400 });
  const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 40) || null : null;

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění zákazníka upravit." }, { status: 403 });

  const { data, error } = await identity.service
    .from("customers")
    .update({ phone, updated_by: identity.user.id, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", identity.membership.organization_id)
    .select("id, phone")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Telefon se nepodařilo uložit." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Zákazník nebyl nalezen." }, { status: 404 });
  return NextResponse.json({ customer: data });
}
