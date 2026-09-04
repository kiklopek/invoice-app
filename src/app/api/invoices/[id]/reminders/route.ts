import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { isDemoMode } from "@/lib/supabase-server";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (isDemoMode()) {
    return NextResponse.json({ reminders: id === "demo-1" ? [
      { id: "r1", stage: "on_due", scheduled_for: "2026-07-28", sent_at: "2026-07-28T06:03:00Z", sent_to: "fakturace@stavbynovak.cz", status: "sent", attempt_count: 1, error_message: null, delivery_status: "delivered", delivery_event_at: "2026-07-28T06:03:12Z", delivered_at: "2026-07-28T06:03:12Z", delivery_error: null },
      { id: "r2", stage: "overdue", scheduled_for: "2026-08-04", sent_at: "2026-08-04T06:02:00Z", sent_to: "fakturace@stavbynovak.cz", status: "sent", attempt_count: 1, error_message: null, delivery_status: "delivered", delivery_event_at: "2026-08-04T06:02:09Z", delivered_at: "2026-08-04T06:02:09Z", delivery_error: null },
      { id: "r3", stage: "escalation", scheduled_for: "2026-08-06", sent_at: null, sent_to: "fakturace@stavbynovak.cz", status: "failed", attempt_count: 1, error_message: "Dočasná chyba e-mailové služby", delivery_status: null, delivery_event_at: null, delivered_at: null, delivery_error: null },
    ] : [], suppression: null });
  }
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  const { data: invoice } = await identity.service.from("invoices").select("id, counterparty_email").eq("id", id).eq("organization_id", identity.membership.organization_id).maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });
  const [historyResult, suppressionResult] = await Promise.all([
    identity.service.from("reminder_log").select("id, stage, scheduled_for, sent_at, sent_to, status, attempt_count, error_message, delivery_status, delivery_event_at, delivered_at, delivery_error").eq("invoice_id", id).order("scheduled_for", { ascending: false }),
    identity.service.from("email_suppressions").select("reason, last_event_at").eq("organization_id", identity.membership.organization_id).eq("email", invoice.counterparty_email.toLowerCase()).maybeSingle(),
  ]);
  if (historyResult.error || suppressionResult.error) return NextResponse.json({ error: "Historii upomínek se nepodařilo načíst." }, { status: 500 });
  return NextResponse.json({ reminders: historyResult.data ?? [], suppression: suppressionResult.data ?? null });
}
