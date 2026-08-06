import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { demoInvoices } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/supabase-server";

export async function GET(_: Request, context: RouteContext<"/api/invoices/[id]/activity">) {
  const { id } = await context.params;
  if (isDemoMode()) {
    const invoice = demoInvoices.find(item => item.id === id);
    if (!invoice) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });
    const events = [
      { id: "demo-event-created", event_type: "created", details: {}, actor_email: "ucetni@hlavica.cz", created_at: invoice.created_at },
      ...(invoice.status === "paid" && invoice.paid_at ? [{ id: "demo-event-paid", event_type: "paid", details: { paid_at: invoice.paid_at }, actor_email: "ucetni@hlavica.cz", created_at: invoice.paid_at }] : []),
      ...(invoice.reminders_sent ? [{ id: "demo-event-updated", event_type: "updated", details: { fields: ["counterparty_email"] }, actor_email: "ucetni@hlavica.cz", created_at: invoice.updated_at }] : []),
    ].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return NextResponse.json({ events });
  }

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  const organizationId = identity.membership.organization_id;
  const { data: invoice, error: invoiceError } = await identity.service.from("invoices").select("id")
    .eq("id", id).eq("organization_id", organizationId).maybeSingle();
  if (invoiceError) return NextResponse.json({ error: "Fakturu se nepodařilo ověřit." }, { status: 500 });
  if (!invoice) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });

  const { data: events, error } = await identity.service.from("invoice_events")
    .select("id, actor_user_id, event_type, details, created_at")
    .eq("invoice_id", id).eq("organization_id", organizationId)
    .order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "Historii změn se nepodařilo načíst." }, { status: 500 });

  const actorIds = [...new Set((events ?? []).map(event => event.actor_user_id).filter((value): value is string => Boolean(value)))];
  const actors = new Map<string, string>();
  if (actorIds.length) {
    const { data: members } = await identity.service.from("organization_members").select("user_id, email")
      .eq("organization_id", organizationId).in("user_id", actorIds);
    for (const member of members ?? []) if (member.user_id) actors.set(member.user_id, member.email);
  }
  return NextResponse.json({
    events: (events ?? []).map(event => ({
      id: event.id,
      event_type: event.event_type,
      details: event.details,
      created_at: event.created_at,
      actor_email: event.actor_user_id ? actors.get(event.actor_user_id) ?? "Bývalý člen týmu" : null,
    })),
  });
}
