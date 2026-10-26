import { describe, expect, it } from "vitest";
import { applyNotificationRead, safeNotificationHref, notificationTime, type NotificationFeed } from "./notifications";
describe("notification presentation", () => {
  it.each(["https://evil.invalid", "//evil.invalid", "javascript:alert(1)", "/api/auth/logout", "/invoices/../settings", "/invoices/<script>", null])("rejects unsafe or invented targets %s", href => expect(safeNotificationHref(href)).toBeNull());
  it.each(["/invoices/00000000-0000-4000-8000-000000000001", "/customers?highlight=00000000-0000-4000-8000-000000000001", "/invoices/payments", "/predplatne", "/settings"])("keeps approved internal routes %s", href => expect(safeNotificationHref(href)).toBe(href));
  it("formats elapsed times and future clock skew", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    expect(notificationTime("2026-10-23T12:01:00Z", now)).toBe("Právě teď");
    expect(notificationTime("2026-10-23T11:00:00Z", now)).toBe("1 hod");
    expect(notificationTime("2026-10-18T12:00:00Z", now)).toBe("5 dní");
  });
});

describe("confirmed read reconciliation", () => {
  const feed: NotificationFeed = { items: [{ id: "one", type: "invoice_paid", title: "One", message: "", href: null, created_at: "2026-10-23T10:00:00Z", read_at: null },{ id: "two", type: "invoice_paid", title: "Two", message: "", href: null, created_at: "2026-10-23T12:00:00Z", read_at: null }], unread_count: 2, total: 2, through: "2026-10-23T11:00:00Z", has_more: false, next_cursor: null };
  it("retains the confirmed receipt locally even if a subsequent refresh fails", () => {
    const next = applyNotificationRead(feed, { ids: ["one"] }, 1, "2026-10-23T13:00:00Z", false)!;
    expect(next.unread_count).toBe(1); expect(next.items[0].read_at).not.toBeNull();
    expect(feed.items[0].read_at).toBeNull(); expect(next.total).toBe(2);
  });
  it("does not consume a newer arrival when reconciling mark-all", () => {
    const next = applyNotificationRead(feed, { all: true, through: feed.through }, 1, "2026-10-23T13:00:00Z", true)!;
    expect(next.items.map(item => item.id)).toEqual(["two"]); expect(next.unread_count).toBe(1); expect(next.total).toBe(1);
  });
  it("does not invent an unloaded page and handles another device having already read the event", () => {
    expect(applyNotificationRead(undefined, { ids: ["one"] }, 1, "now", false)).toBeUndefined();
    expect(applyNotificationRead(feed, { ids: ["one"] }, 0, "now", false)?.unread_count).toBe(1);
  });
});
