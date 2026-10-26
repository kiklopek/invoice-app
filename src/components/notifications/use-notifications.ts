"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/api-client";
import { applyNotificationRead, safeNotificationHref, type NotificationRead, type Notification, type NotificationFeed } from "@/lib/notifications";

export function useNotifications({ unread = false, cursor = null, limit = 8 }: { unread?: boolean; cursor?: string | null; limit?: number } = {}) {
  const params = new URLSearchParams({ limit: String(limit), unread: String(unread) });
  if (cursor) params.set("cursor", cursor);
  return useSWR<NotificationFeed>(`/api/notifications?${params}`, async key => {
    const feed = await apiFetch<NotificationFeed>(key);
    if (!Array.isArray(feed.items) || !Number.isInteger(feed.unread_count) || feed.unread_count < 0 || typeof feed.through !== "string") throw new Error("Neplatná odpověď oznámení.");
    return feed;
  }, {
    refreshInterval: 60_000, refreshWhenHidden: false, refreshWhenOffline: false,
    revalidateOnFocus: true, focusThrottleInterval: 15_000, dedupingInterval: 15_000,
    keepPreviousData: false, shouldRetryOnError: false,
  });
}
export function useNotificationActions(close?: () => void) {
  const router = useRouter();
  const { mutate, cache } = useSWRConfig();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  async function mark(body: NotificationRead) {
    const result = await apiFetch<{ changed: number }>("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const readAt = new Date().toISOString();
    // Confirmed receipt first, then background refresh. A refresh failure must
    // not undo a successful write or prevent navigation to the related object.
    await Promise.all([...cache.keys()].filter(key => key.startsWith("/api/notifications?")).map(key =>
      mutate<NotificationFeed>(key, (current: NotificationFeed | undefined) => applyNotificationRead(current, body, result.changed, readAt, new URLSearchParams(key.split("?")[1]).get("unread") === "true"), { revalidate: false })
    ));
    void mutate(key => typeof key === "string" && key.startsWith("/api/notifications?")).catch(() => {});
  }
  async function activate(item: Notification, navigate = true) {
    const href = safeNotificationHref(item.href);
    // Opening a related record must not wait for a receipt request, or fail
    // because another read operation is still in flight.
    if (href && navigate) { close?.(); router.push(href); }
    if (item.read_at || running.current) return;
    running.current = true;
    setBusy(true); setActionError("");
    try {
      await mark({ ids: [item.id] });
    } catch { setActionError("Oznámení se nepodařilo označit jako přečtené. Zkuste to znovu."); }
    finally { running.current = false; setBusy(false); }
  }
  async function markAll(through: string) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setActionError("");
    try { await mark({ all: true, through }); }
    catch { setActionError("Oznámení se nepodařilo označit jako přečtená. Zkuste to znovu."); }
    finally { running.current = false; setBusy(false); }
  }
  return { busy, actionError, activate, markAll };
}
