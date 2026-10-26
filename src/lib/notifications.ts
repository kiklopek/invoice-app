import type { IconName } from "@/components/icons";

export type NotificationType = "invoice_overdue" | "invoice_paid" | "reminders_paused" | "payment_received" | "payment_review" | "payment_unmatched" | "payment_matched" | "reminder_sent" | "reminder_failed" | "import_failed" | "subscription_problem" | "member_changed" | "customer_created";
export type Notification = { id: string; type: NotificationType; title: string; message: string; created_at: string; read_at: string | null; href: string | null };
export type NotificationFeed = { preview?: boolean; items: Notification[]; unread_count: number; total: number; has_more: boolean; through: string; next_cursor: string | null };
export const notificationStyle: Record<NotificationType, { icon: IconName; tone: string }> = {
  customer_created: { icon: "users", tone: "neutral" },
  invoice_overdue: { icon: "invoice", tone: "danger" }, invoice_paid: { icon: "check", tone: "success" },
  reminders_paused: { icon: "bell", tone: "warning" }, payment_received: { icon: "payment-card", tone: "success" },
  payment_review: { icon: "alert", tone: "warning" }, payment_unmatched: { icon: "payment-card", tone: "warning" },
  payment_matched: { icon: "check", tone: "success" }, reminder_sent: { icon: "mail", tone: "success" },
  reminder_failed: { icon: "alert", tone: "warning" }, import_failed: { icon: "document", tone: "danger" },
  subscription_problem: { icon: "payment-card", tone: "danger" }, member_changed: { icon: "users", tone: "neutral" },
};
export function notificationTime(value: string, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Právě teď";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hod`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} ${Math.floor(seconds / 86400) === 1 ? "den" : Math.floor(seconds / 86400) < 5 ? "dny" : "dní"}`;
  return notificationDate(value);
}
export function notificationDate(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Prague" }).format(new Date(value));
}
// Only explicit internal destinations produced by this feature are actionable.
export function safeNotificationHref(value: string | null) {
  if (!value) return null;
  return /^\/invoices\/[0-9a-f-]{36}$/i.test(value)
    || /^\/invoices\/payments\/archive\?highlight=[0-9a-f-]{36}#payment-[0-9a-f-]{36}$/i.test(value)
    || /^\/customers\?highlight=[0-9a-f-]{36}$/i.test(value)
    || ["/invoices", "/invoices/payments", "/invoices/import", "/predplatne", "/settings"].includes(value) ? value : null;
}

export type NotificationRead = { ids: string[] } | { all: true; through: string };
/** Apply only a confirmed write. Refresh will replace the temporary display timestamp. */
export function applyNotificationRead(feed: NotificationFeed | undefined, mutation: NotificationRead, changed: number, readAt: string, unreadOnly: boolean) {
  if (!feed) return feed;
  const matches = (item: Notification) => "ids" in mutation ? mutation.ids.includes(item.id) : Date.parse(item.created_at) <= Date.parse(mutation.through);
  const known = feed.items.filter(item => !item.read_at && matches(item)).length;
  const items = feed.items.map(item => !item.read_at && matches(item) ? { ...item, read_at: readAt } : item);
  const decrement = Math.max(changed, known);
  return { ...feed, items: unreadOnly ? items.filter(item => !item.read_at) : items,
    unread_count: Math.max(0, feed.unread_count - decrement), total: unreadOnly ? Math.max(0,feed.total-decrement) : feed.total };
}
