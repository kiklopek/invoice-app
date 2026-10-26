"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { CloseIcon } from "@/components/close-icon";
import { useMobileHeaderTarget, useSmallMobile } from "./mobile-header-slot";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import {
  NotificationList,
  NotificationState,
} from "@/components/notifications/notification-list";
import {
  useNotifications,
  useNotificationActions,
} from "@/components/notifications/use-notifications";
import notificationStyles from "@/components/notifications/notifications.module.css";
import styles from "./workspace-topbar.module.css";

export function WorkspaceNotifications() {
  const smallMobile = useSmallMobile();
  const target = useMobileHeaderTarget();
  const panel = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const refreshed = useRef(0);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [maxHeight, setMaxHeight] = useState<number>();
  const { data, error, isLoading, mutate } = useNotifications();
  const { busy, actionError, activate, markAll } = useNotificationActions(
    () => {
      if (panel.current) panel.current.open = false;
    },
  );
  const unread = data?.unread_count ?? 0;
  useEffect(() => {
    refreshed.current = Date.now();
    const outside = (event: PointerEvent) => {
      if (panel.current?.open && !panel.current.contains(event.target as Node))
        panel.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && panel.current?.open) {
        panel.current.open = false;
        trigger.current?.focus();
      }
    };
    const closeOnViewportChange = (event: Event) => {
      if (
        event.type === "scroll" &&
        panel.current?.contains(event.target as Node)
      )
        return;
      if (panel.current) panel.current.open = false;
    };
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const content = (
    <details
      ref={panel}
      className={`${styles.notifications} ${smallMobile && target ? styles.mobileNotifications : ""}`}
      onToggle={(event) => {
        const visible = event.currentTarget.open;
        setOpen(visible);
        if (visible && trigger.current)
          setMaxHeight(
            Math.max(
              180,
              window.innerHeight -
                trigger.current.getBoundingClientRect().bottom -
                24,
            ),
          );
        if (visible && Date.now() - refreshed.current > 15_000) {
          refreshed.current = Date.now();
          void mutate();
        }
      }}
    >
      <summary
        ref={trigger}
        className={styles.notificationButton}
        aria-label={unread ? `Oznámení, ${unread} nepřečtených` : "Oznámení"}
        title="Oznámení"
        aria-expanded={open}
        aria-controls={id}
      >
        <Icon name="bell" />
        {unread > 0 && (
          <i className={styles.notificationDot} aria-hidden="true" />
        )}
        {unread > 0 && (
          <span className={styles.notificationCount} aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </summary>
      {open && (
        <button
          type="button"
          className={styles.notificationBackdrop}
          aria-label="Zavřít oznámení"
          onClick={() => {
            if (panel.current) panel.current.open = false;
            trigger.current?.focus();
          }}
        />
      )}
      {open && (
        <section
          id={id}
          className={styles.notificationPanel}
          style={{ maxHeight }}
          aria-label="Panel oznámení"
        >
          <header>
            <h2>Oznámení</h2>
            <button
              type="button"
              className={notificationStyles.textButton}
              disabled={busy || !unread || !data || Boolean(error)}
              onClick={() => data && void markAll(data.through)}
            >
              Vše jako přečtené
            </button>
            <button
              className={styles.notificationClose}
              type="button"
              aria-label="Zavřít panel oznámení"
              onClick={() => {
                if (panel.current) panel.current.open = false;
                trigger.current?.focus();
              }}
            >
              <CloseIcon />
            </button>
          </header>
          {data?.preview && (
            <p className={notificationStyles.previewNote}>
              Lokální náhled · ukázková oznámení
            </p>
          )}
          {actionError && (
            <p className={notificationStyles.actionError} role="alert">
              {actionError}
            </p>
          )}
          <div className={styles.notificationScroll}>
            {error || isLoading || !data?.items.length ? (
              <NotificationState
                loading={isLoading}
                error={Boolean(error)}
                retry={() => void mutate()}
              />
            ) : (
              <NotificationList
                items={data.items}
                activate={activate}
                busy={busy}
              />
            )}
          </div>
          <footer>
            <Link
              href="/notifications"
              onClick={() => {
                if (panel.current) panel.current.open = false;
              }}
            >
              Zobrazit všechna oznámení <Icon name="arrow-right" />
            </Link>
          </footer>
        </section>
      )}
    </details>
  );
  return smallMobile && target ? createPortal(content, target) : content;
}
