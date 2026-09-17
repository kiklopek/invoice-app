import type { ReminderStage } from "@/types/invoice";

export type ReminderLogState = "queued" | "sent" | "failed" | "skipped";

export interface ReminderScheduleEntry {
  threshold: number;
  scheduledFor: string;
  stage: ReminderStage;
}

export interface ExistingReminderLog {
  id: string;
  scheduled_for: string;
  status: ReminderLogState;
  updated_at?: string;
  attempt_count?: number;
}

export const REMINDER_LEASE_MINUTES = 15;
export const MAX_AUTOMATIC_REMINDER_ATTEMPTS = 3;
export const MAX_MANUAL_REMINDER_ATTEMPTS = 5;

export function hasReminderAttemptBudget(log: ExistingReminderLog | undefined, maximum: number) {
  return !log || Math.max(0, Number(log.attempt_count) || 0) < maximum;
}

export function isStaleQueuedReminder(
  log: ExistingReminderLog | undefined,
  now = new Date(),
  leaseMinutes = REMINDER_LEASE_MINUTES
) {
  if (log?.status !== "queued" || !log.updated_at) return false;
  const updatedAt = new Date(log.updated_at).getTime();
  return Number.isFinite(updatedAt) && updatedAt <= now.getTime() - leaseMinutes * 60_000;
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Neplatné datum: ${value}`);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (formatDate(parsed) !== value) throw new Error(`Neplatné datum: ${value}`);
  return parsed;
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function compareDate(left: string, right: string) {
  return left.localeCompare(right);
}

export function todayInTimeZone(now = new Date(), timeZone = "Europe/Prague") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function buildReminderSchedule(dueDate: string, rawThresholds: number[]) {
  const thresholds = [...new Set(rawThresholds)]
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
  const positive = thresholds.filter(value => value > 0);
  const escalationThreshold = positive.length > 1 ? Math.max(...positive) : null;

  return thresholds.map<ReminderScheduleEntry>((threshold) => {
    const scheduled = parseDate(dueDate);
    scheduled.setUTCDate(scheduled.getUTCDate() + threshold);
    const stage: ReminderStage = threshold < 0
      ? "before_due"
      : threshold === 0
        ? "on_due"
        : threshold === escalationThreshold
          ? "escalation"
          : "overdue";
    return { threshold, scheduledFor: formatDate(scheduled), stage };
  });
}

export function buildEffectiveReminderSchedule(dueDate: string, rawThresholds: number[], effectiveFrom?: string | null) {
  const schedule = buildReminderSchedule(dueDate, rawThresholds);
  return effectiveFrom ? schedule.filter(entry => compareDate(entry.scheduledFor, effectiveFrom) >= 0) : schedule;
}

export function nextFutureReminderAt(dueDate: string, thresholds: number[], today: string) {
  return buildReminderSchedule(dueDate, thresholds).find(entry => compareDate(entry.scheduledFor, today) > 0)?.scheduledFor ?? null;
}

export function decideReminderAction(
  schedule: ReminderScheduleEntry[],
  today: string,
  logs: ExistingReminderLog[],
  now = new Date()
) {
  const eligible = schedule.filter(entry => compareDate(entry.scheduledFor, today) <= 0);
  const latest = eligible.at(-1) ?? null;
  const logsByDate = new Map(logs.map(log => [log.scheduled_for, log]));
  const obsolete = eligible.slice(0, -1).filter(entry => {
    const status = logsByDate.get(entry.scheduledFor)?.status;
    return !status || status === "failed" || isStaleQueuedReminder(logsByDate.get(entry.scheduledFor), now);
  });
  const latestLog = latest ? logsByDate.get(latest.scheduledFor) : undefined;
  const latestStatus = latestLog?.status;
  const candidate = latest && (!latestStatus || latestStatus === "failed" || isStaleQueuedReminder(latestLog, now)) ? latest : null;
  const nextFuture = schedule.find(entry => compareDate(entry.scheduledFor, today) > 0) ?? null;
  return { candidate, obsolete, nextFuture };
}

export function initialNextReminderAt(dueDate: string, thresholds: number[], today: string, effectiveFrom?: string | null) {
  const schedule = buildEffectiveReminderSchedule(dueDate, thresholds, effectiveFrom);
  const due = schedule.filter(entry => compareDate(entry.scheduledFor, today) <= 0).at(-1);
  return due ? today : schedule[0]?.scheduledFor ?? null;
}

export function isLatestEligibleReminder(
  schedule: ReminderScheduleEntry[],
  today: string,
  scheduledFor: string,
  stage: ReminderStage
) {
  const latest = schedule.filter(entry => compareDate(entry.scheduledFor, today) <= 0).at(-1);
  return latest?.scheduledFor === scheduledFor && latest.stage === stage;
}

export const DEFAULT_REMINDER_THRESHOLDS = [-3, 0, 7, 14];

export type ReminderIneligibleReason =
  | "invoice_not_open"
  | "reminders_paused"
  | "policy_inactive"
  | "suppressed"
  | "schedule_stale";

export interface ReminderEligibilityInvoice {
  status: string;
  reminders_paused: boolean;
  due_date: string;
  reminder_days_snapshot?: number[] | null;
  reminder_plan_effective_from?: string | null;
  reminder_policy?: { is_active?: boolean | null } | null;
}

// Shared by the cron worker (src/app/api/cron/check-due/route.ts) and the manual
// retry route (src/app/api/invoices/[id]/reminders/[reminderId]/retry/route.ts) so
// the two places that decide "is this reminder still safe to send" can't drift
// apart and silently reintroduce a double-send or a permanently-stuck reminder.
export function evaluateReminderEligibility(params: {
  invoice: ReminderEligibilityInvoice;
  suppressed: boolean;
  today: string;
  scheduledFor: string;
  stage: ReminderStage;
}): { eligible: true; schedule: ReminderScheduleEntry[] } | { eligible: false; reason: ReminderIneligibleReason } {
  const { invoice, suppressed, today, scheduledFor, stage } = params;
  if (!["pending", "overdue"].includes(invoice.status)) return { eligible: false, reason: "invoice_not_open" };
  if (invoice.reminders_paused) return { eligible: false, reason: "reminders_paused" };
  if (invoice.reminder_policy?.is_active === false) return { eligible: false, reason: "policy_inactive" };
  if (suppressed) return { eligible: false, reason: "suppressed" };
  const schedule = buildEffectiveReminderSchedule(
    invoice.due_date,
    invoice.reminder_days_snapshot ?? DEFAULT_REMINDER_THRESHOLDS,
    invoice.reminder_plan_effective_from,
  );
  if (!isLatestEligibleReminder(schedule, today, scheduledFor, stage)) return { eligible: false, reason: "schedule_stale" };
  return { eligible: true, schedule };
}
