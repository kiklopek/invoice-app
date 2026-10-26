"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { WorkspaceSearch } from "@/components/search/workspace-search";
import { Icon } from "@/components/icons";
import { useAccessProfile } from "@/lib/use-access-role";
import { canManageInvoices } from "@/lib/role-access";
import { useSmallMobile } from "./mobile-header-slot";
import { WorkspaceNotifications } from "./workspace-notifications";
import styles from "./workspace-topbar.module.css";

export function WorkspaceTopbar({
  className = "",
  searchClassName = "",
  primaryClassName = "",
  secondaryClassName = "",
  actionsClassName = "",
}: {
  className?: string;
  searchClassName?: string;
  primaryClassName?: string;
  secondaryClassName?: string;
  actionsClassName?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mobile = useSmallMobile();
  const dashboard = usePathname() === "/dashboard";
  const canManage = canManageInvoices(useAccessProfile()?.role ?? null);
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (mobile)
          document
            .querySelector<HTMLButtonElement>(".small-mobile-search-toggle")
            ?.click();
        else inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, [mobile]);
  return (
    <div className={`${styles.topbar} ${className}`} data-workspace-topbar>
      {!mobile && (
        <WorkspaceSearch
          inputRef={inputRef}
          className={`${styles.search} ${searchClassName}`}
        />
      )}
      <div className={styles.actionGroup}>
        {canManage && (!mobile || dashboard) ? (
          <div className={`${styles.actions} ${dashboard ? styles.dashboardActions : ""} ${actionsClassName}`}>
            <Link
              href="/invoices/import"
              className={`${styles.secondary} ${secondaryClassName}`}
            >
              <Icon name="upload" />
              <span>Importovat fakturu</span>
            </Link>
            <Link
              href="/invoices/new"
              className={`${styles.primary} ${primaryClassName}`}
            >
              <Icon name="plus" />
              <span>Nová faktura</span>
            </Link>
          </div>
        ) : null}
        <WorkspaceNotifications />
      </div>
    </div>
  );
}
