"use client";
import { Icon } from "@/components/icons";
import { notificationStyle, notificationDate, notificationTime, safeNotificationHref, type Notification } from "@/lib/notifications";
import styles from "./notifications.module.css";

export function NotificationList({ items, activate, busy, history = false }: { items: Notification[]; activate: (item: Notification, navigate?: boolean) => Promise<void>; busy: boolean; history?: boolean }) {
  return <ul className={styles.list} aria-label="Seznam oznámení">{items.map(item => {
    const appearance = notificationStyle[item.type] ?? { icon: "bell" as const, tone: "neutral" };
    const href = safeNotificationHref(item.href);
    const contents = <>
      <span className={styles.icon} data-tone={appearance.tone}><Icon name={appearance.icon} />{!item.read_at && <i className={styles.rowDot} aria-hidden="true" />}</span>
      <span className={styles.body}><span className={styles.title}>{item.title}</span><span className={styles.message}>{item.message}</span><span className={styles.srOnly}>{item.read_at ? "Přečtené" : "Nepřečtené"}</span></span>
      <time dateTime={item.created_at} title={notificationDate(item.created_at)}>{history ? notificationDate(item.created_at) : notificationTime(item.created_at)}</time>
    </>;
    return <li key={item.id} data-unread={!item.read_at || undefined}>
      {href ? <a className={styles.row} href={href} onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { if (!item.read_at) void activate(item, false); return; }
        event.preventDefault(); void activate(item);
      }}>{contents}</a> : item.read_at ? <div className={styles.row}>{contents}</div> : <button type="button" className={styles.row} disabled={busy} onClick={() => void activate(item)} aria-label={`${item.title}. ${item.message}. ${item.read_at ? "Přečtené" : "Označit jako přečtené"}`}>{contents}</button>}
    </li>;
  })}</ul>;
}
export function NotificationState({ loading, error, retry, unread = false }: { loading: boolean; error: boolean; retry: () => void; unread?: boolean }) {
  if (loading) return <div className={styles.skeleton} role="status" aria-label="Načítání oznámení">{[0,1,2].map(i => <div key={i}><i/><span/><span/></div>)}</div>;
  if (error) return <div className={styles.state} role="alert"><p>Oznámení se nepodařilo načíst.</p><button type="button" onClick={retry}>Zkusit znovu</button></div>;
  return <div className={styles.state}><strong>{unread ? "Všechna oznámení jsou přečtená" : "Zatím žádná oznámení"}</strong><p>{unread ? "Nová oznámení najdete tady." : "Jakmile se ve vaší firmě stane něco důležitého, dozvíte se to tady."}</p></div>;
}
