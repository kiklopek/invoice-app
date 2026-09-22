import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError, requestId } from "@/lib/structured-log";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { canAccessOperations } from "@/lib/role-access";

export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canAccessOperations(identity.membership.role)) return NextResponse.json({ error: "Čtenář nemá přístup k upomínkám." }, { status: 403 });
  const organizationId = identity.membership.organization_id;
  const [upcomingResult, failedResult, deliveryIssueResult, recentResult, automationRunResult] = await Promise.all([
    identity.service.from("invoices").select("id, invoice_number, counterparty_name, next_reminder_at, amount, currency")
      .eq("organization_id", organizationId).in("status", ["pending", "overdue"]).not("next_reminder_at", "is", null)
      .order("next_reminder_at", { ascending: true }).limit(20),
    identity.service.from("reminder_log").select("id, invoice_id, stage, scheduled_for, sent_to, attempt_count, error_message, updated_at, invoices:invoices!reminder_log_invoice_id_fkey(invoice_number, counterparty_name)")
      .eq("organization_id", organizationId).eq("status", "failed").order("updated_at", { ascending: false }).limit(20),
    identity.service.from("reminder_log").select("id, invoice_id, stage, scheduled_for, sent_to, attempt_count, delivery_status, delivery_error, delivery_event_at, updated_at, invoices:invoices!reminder_log_invoice_id_fkey(invoice_number, counterparty_name)")
      .eq("organization_id", organizationId).in("delivery_status", ["delayed", "bounced", "complained", "failed"])
      .order("delivery_event_at", { ascending: false }).limit(20),
    identity.service.from("reminder_log").select("id, invoice_id, stage, sent_at, sent_to, attempt_count, delivery_status, invoices:invoices!reminder_log_invoice_id_fkey(invoice_number, counterparty_name)")
      .eq("organization_id", organizationId).eq("status", "sent").order("sent_at", { ascending: false }).limit(20),
    identity.service.from("reminder_automation_runs").select("id, status, trigger_source, triggered_by_email, started_at, finished_at, checked, queued, processed, remaining, planner_duration_ms, worker_duration_ms, sent, failed, skipped, disabled, paused, suppressed, exhausted, error_message")
      .eq("organization_id", organizationId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (upcomingResult.error || failedResult.error || deliveryIssueResult.error || recentResult.error || automationRunResult.error) {
    logError("Přehled upomínek se nepodařilo načíst", upcomingResult.error ?? failedResult.error ?? deliveryIssueResult.error ?? recentResult.error ?? automationRunResult.error, {
      upcoming: upcomingResult.error?.message,
      failed: failedResult.error?.message,
      delivery_issues: deliveryIssueResult.error?.message,
      recent: recentResult.error?.message,
      automation_run: automationRunResult.error?.message,
      request_id: requestId(request),
    });
    return apiError(request, "Přehled upomínek se nepodařilo načíst.", 500, "reminders_overview_read_failed");
  }
  const deliveryLabels: Record<string, string> = {
    delayed: "Doručení je odložené",
    bounced: "Přijímající server zprávu odmítl",
    complained: "Příjemce označil zprávu jako spam",
    failed: "E-mailová služba zprávu nedoručila",
  };
  const failedById = new Map<string, Record<string, unknown>>();
  for (const item of failedResult.data ?? []) failedById.set(item.id, item);
  for (const item of deliveryIssueResult.data ?? []) failedById.set(item.id, {
    ...item,
    error_message: item.delivery_error || deliveryLabels[item.delivery_status ?? ""] || "Problém s doručením",
    updated_at: item.delivery_event_at || item.updated_at,
  });
  const failed = [...failedById.values()].sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))).slice(0, 20);
  return NextResponse.json({ can_run: canManageInvoices(identity.membership.role), upcoming: upcomingResult.data ?? [], failed, recent: recentResult.data ?? [], automation_run: automationRunResult.data ?? null });
}
