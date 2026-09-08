export const DEFAULT_REMINDER_DAYS = [-3, 0, 7, 14] as const;

export type ReminderPolicySummary = {
  id: string;
  name: string;
  is_default: boolean;
  days_from_due: number[];
  archived_at: string | null;
};

export function normalizeReminderDays(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const rawDays = value.map(Number);
  if (new Set(rawDays).size !== rawDays.length) return null;
  const days = rawDays.sort((a, b) => a - b);
  if (days.length < 1 || days.length > 10) return null;
  if (days.some(day => !Number.isInteger(day) || day < -90 || day > 365)) return null;
  return days;
}

export function reminderDayLabel(day: number) {
  if (day === 0) return "V den splatnosti";
  const amount = Math.abs(day);
  const unit = amount === 1 ? "den" : amount < 5 ? "dny" : "dní";
  return `${amount} ${unit} ${day < 0 ? "před splatností" : "po splatnosti"}`;
}
