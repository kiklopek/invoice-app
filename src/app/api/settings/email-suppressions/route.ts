import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";

export async function GET() {
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) {
    return NextResponse.json({ error: "Nemáte oprávnění zobrazit blokované adresy." }, { status: 403 });
  }
  const { data, error } = await identity.service.from("email_suppressions")
    .select("id, email, reason, last_event_at")
    .eq("organization_id", identity.membership.organization_id)
    .order("last_event_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: "Seznam blokovaných adres se nepodařilo načíst." }, { status: 500 });
  return NextResponse.json({ suppressions: data ?? [] });
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  }
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) {
    return NextResponse.json({ error: "Nemáte oprávnění tuto adresu odblokovat." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254) {
    return NextResponse.json({ error: "Neplatná e-mailová adresa." }, { status: 400 });
  }
  const { error } = await identity.service.from("email_suppressions").delete()
    .eq("organization_id", identity.membership.organization_id)
    .eq("email", email);
  if (error) return NextResponse.json({ error: "Adresu se nepodařilo odblokovat." }, { status: 500 });
  return NextResponse.json({ removed: true });
}
