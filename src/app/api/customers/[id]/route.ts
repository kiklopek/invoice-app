import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { isBlockedReminderRecipient } from "@/lib/reminder-recipient-policy";

type Context = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Neplatný identifikátor zákazníka." }, { status: 400 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Array.isArray(body) || !("phone" in body || "email" in body)) return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  if ("phone" in body && body.phone !== null && typeof body.phone !== "string") return NextResponse.json({ error: "Neplatné telefonní číslo." }, { status: 400 });
  const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 40) || null : null;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if ("email" in body && (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return NextResponse.json({ error: "Zadejte platný e-mail zákazníka." }, { status: 400 });
  }

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění zákazníka upravit." }, { status: 403 });

  if ("email" in body) {
    const { data: issuer, error: issuerError } = await identity.service.from("organizations")
      .select("name, email").eq("id", identity.membership.organization_id).single();
    if (issuerError || !issuer) {
      logError("Firemní údaje pro ověření kontaktu se nepodařilo načíst", issuerError);
      return apiError(request, "Firemní údaje se nepodařilo ověřit.", 503, "customer_issuer_read_failed");
    }
    if (isBlockedReminderRecipient(email, issuer)) {
      return NextResponse.json({ error: "E-mail pro upomínky patří vaší firmě. Zadejte adresu odběratele." }, { status: 400 });
    }
  }

  const { data, error } = await identity.service.rpc("update_customer_contact", {
    target_org: identity.membership.organization_id, actor_user: identity.user.id,
    target_customer: id, change_email: "email" in body, new_email: email || null,
    change_phone: "phone" in body, new_phone: phone,
  });
  if (error) {
    logError("Kontakt zákazníka se nepodařilo uložit", error, { customer_id: id });
    return apiError(request, "Kontakt se nepodařilo uložit.", 500, "customer_contact_write_failed");
  }
  if (!data) return NextResponse.json({ error: "Zákazník nebyl nalezen." }, { status: 404 });
  return NextResponse.json(data);
}
