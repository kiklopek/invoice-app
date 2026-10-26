"use client";
import { useState } from "react";
import { AppFrame } from "@/components/layout/app-shell";
import { NotificationList, NotificationState } from "@/components/notifications/notification-list";
import { useNotifications, useNotificationActions } from "@/components/notifications/use-notifications";
import styles from "@/components/notifications/notifications.module.css";

export function NotificationsClient() {
  const [unread, setUnread] = useState(false);
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const { data, error, isLoading, mutate } = useNotifications({ unread, cursor: pages.at(-1) ?? null, limit: 30 });
  const { busy, actionError, activate, markAll } = useNotificationActions();
  return <AppFrame className="content section-page"><div className={styles.history}>
    <header className={styles.heading}><div><h1>Oznámení</h1><p>Důležité události vaší firmy.</p></div><button className={styles.textButton} type="button" disabled={busy || !data?.unread_count || Boolean(error)} onClick={() => data && void markAll(data.through)}>Vše jako přečtené</button></header>
    <section className={styles.panel} aria-label="Historie oznámení">
      <div className={styles.filters} aria-label="Filtr oznámení">{[false, true].map(value => <button key={String(value)} type="button" aria-pressed={unread === value} onClick={() => { setUnread(value); setPages([null]); }}>{value ? "Nepřečtená" : "Všechna"}</button>)}</div>
      {data?.preview && <p className={styles.previewNote}>Lokální náhled · ukázková oznámení</p>}
      {actionError && <p className={styles.actionError} role="alert">{actionError}</p>}
      {error || isLoading || !data?.items.length ? <NotificationState loading={isLoading} error={Boolean(error)} retry={() => void mutate()} unread={unread} /> : <NotificationList items={data.items} activate={activate} busy={busy} history />}
      <footer className={styles.pagination}><span>{data ? `${data.total} oznámení · strana ${pages.length}` : ""}</span><div><button type="button" disabled={pages.length === 1 || isLoading} onClick={() => setPages(current => current.slice(0,-1))}>Předchozí</button>{" "}<button type="button" disabled={!data?.next_cursor || isLoading || Boolean(error)} onClick={() => { if (data?.next_cursor) setPages(current => [...current,data.next_cursor]); }}>Další</button></div></footer>
    </section>
  </div></AppFrame>;
}
