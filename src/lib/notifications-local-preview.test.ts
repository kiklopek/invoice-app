import { afterEach, describe, expect, it, vi } from "vitest";
import { localNotificationsPreview, previewFeed, previewRead } from "./notifications-local-preview";
const options = { unread: false, limit: 2, beforeTime: null, beforeId: null };
afterEach(() => vi.unstubAllEnvs());
describe("localhost notification preview", () => {
  it("requires explicit opt-in, development and a loopback host", () => {
    vi.stubEnv("LOCAL_NOTIFICATIONS_PREVIEW", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(localNotificationsPreview(new Request("http://localhost:3000/api/notifications"))).toBe(true);
    expect(localNotificationsPreview(new Request("https://www.splatno.com/api/notifications"))).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(localNotificationsPreview(new Request("http://localhost:3000/api/notifications"))).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOCAL_NOTIFICATIONS_PREVIEW", "false");
    expect(localNotificationsPreview(new Request("http://localhost:3000/api/notifications"))).toBe(false);
  });
  it("paginates labeled samples, persists personal reads only in a local cookie", async () => {
    const request = new Request("http://localhost:3000/api/notifications");
    const first = previewFeed(request, "company:user", options);
    expect(first.preview).toBe(true);
    expect(first.unread_count).toBe(5);
    expect(first.items).toHaveLength(2);
    expect(first.items.every(item => item.message.startsWith("Ukázka:"))).toBe(true);
    const last = first.items.at(-1)!;
    const next = previewFeed(request, "company:user", { ...options, beforeTime: last.created_at, beforeId: last.id });
    expect(next.items.some(item => first.items.some(previous => previous.id === item.id))).toBe(false);
    const response = previewRead(request, "company:user", { all: true, through: first.through });
    expect(await response.json()).toEqual({ changed: 5 });
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    const after = new Request(request, { headers: { cookie: cookie.split(";")[0] } });
    expect(previewFeed(after, "company:user", options).unread_count).toBe(0);
    expect(previewFeed(after, "company:other-user", options).unread_count).toBe(5);
    expect(previewFeed(after, "other-company:user", options).unread_count).toBe(5);
    expect(previewFeed(after, "company:user", { ...options, unread: true }).total).toBe(0);
    expect((await previewRead(after, "company:user", { all: true, through: first.through }).json()).changed).toBe(0);
  });
  it("links invoice examples to existing invoices and falls back to the list", () => {
    const request = new Request("http://localhost:3000/api/notifications");
    const invoices = [
      { id: "00000000-0000-4000-8000-000000000101", invoice_number: "REAL-1", status: "overdue" },
      { id: "00000000-0000-4000-8000-000000000102", invoice_number: "REAL-2", status: "paid" },
    ];
    const feed = previewFeed(request, "company:user", { ...options, limit: 8 }, invoices);
    expect(feed.items.find(item => item.type === "invoice_overdue")?.href).toBe(`/invoices/${invoices[0].id}`);
    expect(feed.items.find(item => item.type === "invoice_paid")?.href).toBe(`/invoices/${invoices[1].id}`);
    expect(feed.items.find(item => item.type === "reminder_failed")?.href).toBe(`/invoices/${invoices[0].id}`);
    expect(feed.items.find(item => item.type === "invoice_paid")?.message).toContain("REAL-2");
    expect(previewFeed(request, "company:user", options).items[0].href).toBe("/invoices");
  });
  it("rejects unknown IDs and handles corrupted receipts", () => {
    const request = new Request("http://localhost:3000/api/notifications", { headers: { cookie: "broken=value" } });
    expect(previewRead(request, "company:user", { ids: ["unknown"] }).status).toBe(400);
    expect(previewFeed(request, "company:user", options).unread_count).toBe(5);
  });
});
