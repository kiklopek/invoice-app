import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { demoInvoices } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/supabase-server";
import { canAccessOperations } from "@/lib/role-access";

export async function GET() {
  if (isDemoMode()) {
    return NextResponse.json({
      can_run: true,
      upcoming: demoInvoices.filter(invoice => invoice.next_reminder_at && ["pending", "overdue"].includes(invoice.status)).map(invoice => ({ id: invoice.id, invoice_number: invoice.invoice_number, counterparty_name: invoice.counterparty_name, next_reminder_at: invoice.next_reminder_at!, amount: invoice.amount, currency: invoice.currency })).sort((a, b) => a.next_reminder_at.localeCompare(b.next_reminder_at)),
      failed: [],
      recent: [{ id: "demo-reminder", invoice_id: "demo-1", stage: "overdue", sent_at: demoInvoices[0].last_reminder_at, sent_to: demoInvoices[0].counterparty_email, attempt_count: 1, invoices: { invoice_number: demoInvoices[0].invoice_number, counterparty_name: demoInvoices[0].counterparty_name } }],
      automation_run: { id: "demo-run", status: "succeeded", trigger_source: "scheduled", triggered_by_email: null, started_at: new Date(Date.now() - 15 * 60_000).toISOString(), finished_at: new Date(Date.now() - 14 * 60_000).toISOString(), checked: demoInvoices.length, sent: 1, failed: 0, skipped: 0, disabled: 0, paused: 0, suppressed: 0, exhausted: 0, error_message: null },
    });
  }

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
    identity.service.from("reminder_automation_runs").select("id, status, trigger_source, triggered_by_email, started_at, finished_at, checked, sent, failed, skipped, disabled, paused, suppressed, exhausted, error_message")
      .eq("organization_id", organizationId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (upcomingResult.error || failedResult.error || deliveryIssueResult.error || recentResult.error || automationRunResult.error) {
    console.error("[api/reminders] overview query failed", {
      upcoming: upcomingResult.error?.message,
      failed: failedResult.error?.message,
      deliveryIssues: deliveryIssueResult.error?.message,
      recent: recentResult.error?.message,
      automationRun: automationRunResult.error?.message,
    });
    return NextResponse.json({ error: "Přehled upomínek se nepodařilo načíst." }, { status: 500 });
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
