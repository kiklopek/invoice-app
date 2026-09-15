import "server-only";

import type { RequestIdentity } from "@/lib/auth";
import type { AutomationRun } from "@/lib/automation-run";
import { defaultReminderTemplates } from "@/lib/reminder-defaults";
import type { ReminderEmailCompany } from "@/lib/reminder-email-template";
import { DEFAULT_REMINDER_DAYS, type ReminderPolicySummary } from "@/lib/reminder-policies";
import { canAccessOperations, canManageInvoices } from "@/lib/role-access";
import { PageDataError } from "@/lib/dashboard-page-data";
import type { ReminderStage } from "@/types/invoice";

export type ReminderTemplateSettings = { subject: string; body: string; reply_to: string | null; cc: string[] };
export type SettingsChange = { id: string; changed_at: string; changed_by: string };
type ReminderInvoice = { invoice_number: string; counterparty_name: string };
export type ReminderOperations = {
  can_run: boolean;
  upcoming: { id: string; invoice_number: string; counterparty_name: string; next_reminder_at: string; amount: number; currency: string }[];
  failed: { id: string; invoice_id: string; stage: ReminderStage; scheduled_for: string; sent_to: string; attempt_count: number; error_message: string | null; delivery_status?: "delayed" | "bounced" | "complained" | "failed" | null; updated_at: string; invoices: ReminderInvoice }[];
  recent: { id: string; invoice_id: string; stage: ReminderStage; sent_at: string; sent_to: string; attempt_count: number; delivery_status?: string | null; invoices: ReminderInvoice }[];
  automation_run: AutomationRun | null;
};
export type ReminderPageData = {
  settings: { active: boolean; days: number[]; templates: Record<ReminderStage, ReminderTemplateSettings>; last_change: SettingsChange | null };
  operations: ReminderOperations;
  company: ReminderEmailCompany | null;
  policies: ReminderPolicySummary[];
};

const stages: ReminderStage[] = ["before_due", "on_due", "overdue", "escalation"];

function defaultTemplates() {
  return stages.reduce<Record<ReminderStage, ReminderTemplateSettings>>((result, stage) => {
    result[stage] = { ...defaultReminderTemplates[stage], reply_to: null, cc: [] };
    return result;
  }, {} as Record<ReminderStage, ReminderTemplateSettings>);
}

export async function loadReminderPageData(identity: RequestIdentity | null): Promise<ReminderPageData> {
  if (!identity) throw new PageDataError("Nejste přihlášený uživatel.", 401);
  if (!canAccessOperations(identity.membership.role)) throw new PageDataError("K upomínkám nemáte přístup.", 403);
  const org = identity.membership.organization_id;

  const [defaultPolicy, templatesResult, changeResult, companyResult, policiesResult, upcomingResult, failedResult, deliveryIssueResult, recentResult, automationRunResult] = await Promise.all([
    identity.service.from("reminder_policies").select("days_from_due, is_active").eq("organization_id", org).eq("is_default", true).maybeSingle(),
    identity.service.from("email_templates").select("stage, subject, body, reply_to, cc").eq("organization_id", org),
    identity.service.from("reminder_settings_events").select("id, actor_email, created_at").eq("organization_id", org).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
    identity.service.from("organizations").select("name, ico, dic, registered_address, operating_address, data_box_id, phone, email, bank_account_czk, bank_account_eur").eq("id", org).single(),
    identity.service.from("reminder_policies").select("id, name, is_default, days_from_due, archived_at").eq("organization_id", org).order("is_default", { ascending: false }).order("name"),
    identity.service.from("invoices").select("id, invoice_number, counterparty_name, next_reminder_at, amount, currency").eq("organization_id", org).in("status", ["pending", "overdue"]).not("next_reminder_at", "is", null).order("next_reminder_at", { ascending: true }).limit(20),
    identity.service.from("reminder_log").select("id, invoice_id, stage, scheduled_for, sent_to, attempt_count, error_message, updated_at, invoices:invoices!reminder_log_invoice_id_fkey(invoice_number, counterparty_name)").eq("organization_id", org).eq("status", "failed").order("updated_at", { ascending: false }).limit(20),
    identity.service.from("reminder_log").select("id, invoice_id, stage, scheduled_for, sent_to, attempt_count, delivery_status, delivery_error, delivery_event_at, updated_at, invoices:invoices!reminder_log_invoice_id_fkey(invoice_number, counterparty_name)").eq("organization_id", org).in("delivery_status", ["delayed", "bounced", "complained", "failed"]).order("delivery_event_at", { ascending: false }).limit(20),
    identity.service.from("reminder_log").select("id, invoice_id, stage, sent_at, sent_to, attempt_count, delivery_status, invoices:invoices!reminder_log_invoice_id_fkey(invoice_number, counterparty_name)").eq("organization_id", org).eq("status", "sent").order("sent_at", { ascending: false }).limit(20),
    identity.service.from("reminder_automation_runs").select("id, status, trigger_source, triggered_by_email, started_at, finished_at, checked, queued, processed, remaining, planner_duration_ms, worker_duration_ms, sent, failed, skipped, disabled, paused, suppressed, exhausted, error_message").eq("organization_id", org).order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const criticalResults = [defaultPolicy, templatesResult, companyResult, policiesResult];
  if (criticalResults.some(result => result.error)) throw new PageDataError("Editor upomínek se nepodařilo načíst. Zkontrolujte databázovou migraci.", 500);

  const templates = defaultTemplates();
  for (const template of templatesResult.data ?? []) if (stages.includes(template.stage as ReminderStage)) {
    templates[template.stage as ReminderStage] = { subject: template.subject, body: template.body, reply_to: template.reply_to ?? null, cc: template.cc ?? [] };
  }
  const deliveryLabels: Record<string, string> = { delayed: "Doručení je odložené", bounced: "Přijímající server zprávu odmítl", complained: "Příjemce označil zprávu jako spam", failed: "E-mailová služba zprávu nedoručila" };
  const failedById = new Map<string, Record<string, unknown>>();
  for (const item of failedResult.error ? [] : failedResult.data ?? []) failedById.set(item.id, item);
  for (const item of deliveryIssueResult.error ? [] : deliveryIssueResult.data ?? []) failedById.set(item.id, { ...item, error_message: item.delivery_error || deliveryLabels[item.delivery_status ?? ""] || "Problém s doručením", updated_at: item.delivery_event_at || item.updated_at });
  const failed = [...failedById.values()].sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))).slice(0, 20) as ReminderOperations["failed"];

  return {
    settings: {
      active: defaultPolicy.data?.is_active ?? true,
      days: defaultPolicy.data?.days_from_due ?? [...DEFAULT_REMINDER_DAYS],
      templates,
      last_change: !changeResult.error && changeResult.data ? { id: changeResult.data.id, changed_at: changeResult.data.created_at, changed_by: changeResult.data.actor_email } : null,
    },
    operations: {
      can_run: canManageInvoices(identity.membership.role),
      upcoming: (upcomingResult.error ? [] : upcomingResult.data ?? []) as ReminderOperations["upcoming"], failed,
      recent: (recentResult.error ? [] : recentResult.data ?? []) as ReminderOperations["recent"],
      automation_run: automationRunResult.error ? null : automationRunResult.data as AutomationRun | null,
    },
    company: companyResult.data as ReminderEmailCompany,
    policies: (policiesResult.data ?? []) as ReminderPolicySummary[],
  };
}
