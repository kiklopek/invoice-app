import "server-only";

import type { RequestIdentity } from "@/lib/auth";
import { canManageInvoices } from "@/lib/role-access";
import { PageDataError } from "@/lib/dashboard-page-data";
import { loadInvoicePaymentHistory, type InvoicePaymentHistoryEntry } from "@/lib/invoice-payment-history";
import type { Invoice, InvoiceEventType, ReminderStage } from "@/types/invoice";

export type ReminderRecord = {
  id: string; stage: ReminderStage; scheduled_for: string; sent_at: string | null; sent_to: string;
  status: "queued" | "sent" | "failed" | "skipped"; attempt_count: number; error_message: string | null;
  delivery_status: "accepted" | "delivered" | "delayed" | "bounced" | "complained" | "failed" | null;
  delivery_event_at: string | null; delivered_at: string | null; delivery_error: string | null;
};
export type EmailSuppression = { reason: "bounced" | "complained"; last_event_at: string };
export type ActivityRecord = {
  id: string;
  event_type: InvoiceEventType;
  details: { fields?: string[]; paid_at?: string; corrected?: boolean; detached_payments?: number; from?: number; to?: number; remaining?: number; sent_to?: string };
  actor_email: string | null;
  created_at: string;
};
export type BankPayment = InvoicePaymentHistoryEntry;
export type InvoiceDetailPageData = {
  invoice: Invoice;
  payments: BankPayment[];
  can_manage: boolean;
  reminders: ReminderRecord[];
  suppression: EmailSuppression | null;
  events: ActivityRecord[];
};

export async function loadInvoiceDetailPageData(identity: RequestIdentity | null, id: string): Promise<InvoiceDetailPageData> {
  if (!identity) throw new PageDataError("Nejste přihlášený uživatel.", 401);
  const organizationId = identity.membership.organization_id;
  const { data: invoice, error: invoiceError } = await identity.service.from("invoices")
    .select("*, reminder_policy:reminder_policies!invoices_policy_same_org_fkey(name, archived_at)")
    .eq("id", id).eq("organization_id", organizationId).maybeSingle();
  if (invoiceError) throw new PageDataError("Fakturu se nepodařilo načíst.", 500);
  if (!invoice) throw new PageDataError("Faktura nebyla nalezena.", 404);

  const [paymentsResult, historyResult, suppressionResult, eventsResult] = await Promise.all([
    loadInvoicePaymentHistory(identity.service, organizationId, id).then(
      (value) => ({ data: value, error: null }),
      (error) => ({ data: null, error }),
    ),
    identity.service.from("reminder_log").select("id, stage, scheduled_for, sent_at, sent_to, status, attempt_count, error_message, delivery_status, delivery_event_at, delivered_at, delivery_error")
      .eq("invoice_id", id).order("scheduled_for", { ascending: false }),
    identity.service.from("email_suppressions").select("reason, last_event_at").eq("organization_id", organizationId)
      .eq("email", invoice.counterparty_email.toLowerCase()).maybeSingle(),
    identity.service.from("invoice_events").select("id, actor_user_id, event_type, details, created_at")
      .eq("invoice_id", id).eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(100),
  ]);
  if (paymentsResult.error || historyResult.error || suppressionResult.error || eventsResult.error) {
    throw new PageDataError("Údaje faktury se nepodařilo načíst.", 500);
  }

  const actorIds = [...new Set((eventsResult.data ?? []).map(event => event.actor_user_id).filter((value): value is string => Boolean(value)))];
  const actors = new Map<string, string>();
  if (actorIds.length) {
    const { data: members } = await identity.service.from("organization_members").select("user_id, email")
      .eq("organization_id", organizationId).in("user_id", actorIds);
    for (const member of members ?? []) if (member.user_id) actors.set(member.user_id, member.email);
  }
  const events = (eventsResult.data ?? []).map(event => ({
    id: event.id,
    event_type: event.event_type,
    details: event.details,
    created_at: event.created_at,
    actor_email: event.actor_user_id ? actors.get(event.actor_user_id) ?? "Bývalý člen týmu" : null,
  })) as ActivityRecord[];

  return {
    invoice: invoice as Invoice,
    payments: paymentsResult.data ?? [],
    can_manage: canManageInvoices(identity.membership.role),
    reminders: (historyResult.data ?? []) as ReminderRecord[],
    suppression: suppressionResult.data as EmailSuppression | null,
    events,
  };
}
