import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { getRequestIdentity } from "@/lib/auth";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  const organizationId = identity.membership.organization_id;
  const { data: invoice, error: invoiceError } = await identity.service.from("invoices").select("id")
    .eq("id", id).eq("organization_id", organizationId).maybeSingle();
  if (invoiceError) {
    logError("Fakturu se nepodařilo ověřit pro historii změn", invoiceError);
    return apiError(request, "Fakturu se nepodařilo ověřit.", 500, "invoice_lookup_failed");
  }
  if (!invoice) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });

  const { data: events, error } = await identity.service.from("invoice_events")
    .select("id, actor_user_id, event_type, details, created_at")
    .eq("invoice_id", id).eq("organization_id", organizationId)
    .order("created_at", { ascending: false }).limit(100);
  if (error) {
    logError("Historii změn faktury se nepodařilo načíst", error);
    return apiError(request, "Historii změn se nepodařilo načíst.", 500, "invoice_activity_read_failed");
  }

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
