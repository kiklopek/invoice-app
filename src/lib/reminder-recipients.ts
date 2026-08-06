const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MAX_REMINDER_CC_RECIPIENTS = 5;

export type ReminderDeliverySettings = {
  reply_to: string | null;
  cc: string[];
};

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeReminderDeliverySettings(replyTo: unknown, rawCc: unknown): ReminderDeliverySettings | null {
  const reply_to = normalizeEmail(replyTo) || null;
  if (reply_to && (reply_to.length > 254 || !EMAIL_PATTERN.test(reply_to))) return null;

  if (rawCc !== undefined && rawCc !== null && !Array.isArray(rawCc)) return null;
  const cc = [...new Set((Array.isArray(rawCc) ? rawCc : []).map(normalizeEmail).filter(Boolean))];
  if (cc.length > MAX_REMINDER_CC_RECIPIENTS || cc.some(email => email.length > 254 || !EMAIL_PATTERN.test(email))) return null;

  return { reply_to, cc };
}

export function parseReminderCcInput(value: string) {
  return value.split(/[;,\n]/).map(email => email.trim()).filter(Boolean);
}
