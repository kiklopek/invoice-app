"use client";
import { useEffect, useId, useState, type ReactNode } from "react";
import { MobileDisclosure } from "@/components/mobile-disclosure";
import { Modal } from "@/components/modal";
import { CloseIcon } from "@/components/close-icon";
import { Icon } from "@/components/icons";
import { useSmallMobile } from "@/components/layout/mobile-header-slot";
import styles from "./mobile-invoices.module.css";

export function MobileInvoiceFilters({
  children,
  label,
  className,
  query,
  onQuery,
  status,
  onStatus,
  onReset,
  active,
}: {
  children: ReactNode;
  label: string;
  className: string;
  query: string;
  onQuery: (value: string) => void;
  status: string;
  onStatus: (value: "all" | "pending" | "overdue") => void;
  onReset: () => void;
  active: boolean;
}) {
  const mobile = useSmallMobile(),
    id = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [mobile]);
  if (!mobile)
    return (
      <MobileDisclosure label={label} className={className}>
        {children}
      </MobileDisclosure>
    );
  return (
    <>
      <div className={styles.searchRow}>
        <label>
          <Icon name="search" />
          <span className={styles.srOnly}>Hledat ve fakturách</span>
          <input
            type="search"
            value={query}
            maxLength={100}
            placeholder="Hledat fakturu, odběratele…"
            onChange={(e) => onQuery(e.target.value)}
          />
        </label>
        <button
          type="button"
          aria-label={active ? "Filtry faktur · aktivní" : "Filtry faktur"}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={styles.filterButton}
          data-active={active || undefined}
          onClick={() => setOpen(true)}
        >
          <Icon name="filter" />
        </button>
      </div>
      <div
        className={styles.statusFilters}
        role="group"
        aria-label="Rychlý filtr stavu faktur"
      >
        {(
          [
            ["all", "Všechny"],
            ["overdue", "Po splatnosti"],
            ["pending", "Čeká na úhradu"],
          ] as const
        ).map(([value, title]) => (
          <button
            type="button"
            key={value}
            aria-pressed={status === value}
            onClick={() => onStatus(value)}
          >
            {title}
          </button>
        ))}
      </div>
      {active && (
        <button type="button" className={styles.clearFilters} onClick={onReset}>
          Vymazat filtry <CloseIcon />
        </button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        labelledBy={id}
        className={styles.filterSheet}
      >
        <header className={styles.sheetHeading}>
          <h2 id={id}>Filtry faktur</h2>
          <button
            type="button"
            aria-label="Zavřít filtry"
            onClick={() => setOpen(false)}
          >
            <CloseIcon />
          </button>
        </header>
        <div className={styles.sheetContent}>{children}</div>
        <div className={styles.sheetActions}>
          <button type="button" className="btn secondary" onClick={onReset}>
            Resetovat
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => setOpen(false)}
          >
            Zobrazit výsledky
          </button>
        </div>
      </Modal>
    </>
  );
}
