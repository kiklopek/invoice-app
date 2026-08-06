export const RESEND_DELIVERY_EVENTS = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
] as const;

export type ResendDeliveryEventType = typeof RESEND_DELIVERY_EVENTS[number];

export interface ResendDeliveryEvent {
  type: ResendDeliveryEventType;
  createdAt: string;
  emailId: string;
  error: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseResendDeliveryEvent(value: unknown): ResendDeliveryEvent | null {
  const event = record(value);
  if (!event || typeof event.type !== "string" || !RESEND_DELIVERY_EVENTS.includes(event.type as ResendDeliveryEventType)) return null;
  if (typeof event.created_at !== "string" || !Number.isFinite(Date.parse(event.created_at))) return null;
  const data = record(event.data);
  if (!data || typeof data.email_id !== "string" || !data.email_id.trim() || data.email_id.length > 200) return null;

  const bounce = record(data.bounce);
  const failed = record(data.failed);
  const error = typeof bounce?.message === "string" ? bounce.message.trim().slice(0, 1000)
    : typeof failed?.reason === "string" ? failed.reason.trim().slice(0, 1000)
    : event.type === "email.delivery_delayed" ? "Doručení bylo dočasně odloženo přijímajícím serverem."
    : event.type === "email.complained" ? "Příjemce označil zprávu jako nevyžádanou."
    : null;

  return {
    type: event.type as ResendDeliveryEventType,
    createdAt: new Date(event.created_at).toISOString(),
    emailId: data.email_id.trim(),
    error: error || null,
  };
}
