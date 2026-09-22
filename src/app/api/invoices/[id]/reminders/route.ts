import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { getRequestIdentity } from "@/lib/auth";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  const { data: invoice } = await identity.service.from("invoices").select("id, counterparty_email").eq("id", id).eq("organization_id", identity.membership.organization_id).maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });
  const [historyResult, suppressionResult] = await Promise.all([
    identity.service.from("reminder_log").select("id, stage, scheduled_for, sent_at, sent_to, status, attempt_count, error_message, delivery_status, delivery_event_at, delivered_at, delivery_error").eq("invoice_id", id).order("scheduled_for", { ascending: false }),
    identity.service.from("email_suppressions").select("reason, last_event_at").eq("organization_id", identity.membership.organization_id).eq("email", invoice.counterparty_email.toLowerCase()).maybeSingle(),
  ]);
  if (historyResult.error || suppressionResult.error) {
    logError("Historii upomínek se nepodařilo načíst", historyResult.error ?? suppressionResult.error);
    return apiError(request, "Historii upomínek se nepodařilo načíst.", 500, "reminder_history_read_failed");
  }
  return NextResponse.json({ reminders: historyResult.data ?? [], suppression: suppressionResult.data ?? null });
}
