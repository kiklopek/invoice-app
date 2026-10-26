"use client";

import Link from "next/link";
import useSWR from "swr";
import { useEffect, useRef, useState } from "react";
import { todayInTimeZone } from "@/lib/reminders";
import { Icon } from "@/components/icons";
import type { DashboardPageData } from "@/lib/dashboard-page-data";
import type { DashboardUpcoming } from "@/lib/dashboard-summary";
import type { InvoiceDetailPageData } from "@/lib/invoice-detail-page-data";
import { ExactMoney } from "@/components/money-amount";
import { dashboardDate } from "./dashboard-presentation";
import styles from "./dashboard-summary.module.css";
import {
  fetchReminderRead,
  reminderReadError,
} from "./dashboard-reminder-fetch";

function useReminder(item: DashboardUpcoming | undefined) {
  return useSWR<InvoiceDetailPageData>(
    item ? `/api/invoices/${item.id}/page-data` : null,
    fetchReminderRead<InvoiceDetailPageData>,
    { refreshInterval: 60_000, keepPreviousData: false },
  );
}

function UpcomingReminder({
  item,
  active,
  today,
  eager,
}: {
  item: DashboardUpcoming;
  active: boolean | undefined;
  today: string;
  eager: boolean;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (
      eager ||
      visible ||
      typeof IntersectionObserver === "undefined" ||
      !rowRef.current
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "80px" },
    );
    observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, [eager, visible]);
  // Only validate rows near the visible scroll area, rather than issuing dozens
  // of invoice-detail requests when the dashboard opens.
  const { data, error, mutate } = useReminder(
    eager || visible || typeof IntersectionObserver === "undefined"
      ? item
      : undefined,
  );
  const invoice = data?.invoice;
  const open = invoice?.status === "pending" || invoice?.status === "overdue";
  const rawDate = invoice ? invoice.next_reminder_at : item.next_reminder_at;
  const date = rawDate && Number.isFinite(Date.parse(rawDate)) ? rawDate : null;
  const day = date ? todayInTimeZone(new Date(date)) : null;
  const due =
    day === today ? "today" : day && day < today ? "overdue" : "scheduled";
  const blocked =
    !!error ||
    active === false ||
    !!invoice?.reminders_paused ||
    !!data?.suppression ||
    (!!invoice && (!open || !date));
  const status = error
    ? "Stav nelze ověřit"
    : !invoice
      ? "Ověřuji stav…"
      : !open
        ? "Faktura již uzavřená"
        : invoice.reminders_paused
          ? "Pozastaveno u faktury"
          : data.suppression
            ? "Zkontrolujte e-mail"
            : !date
              ? "Bez dalšího plánu"
              : active === false
                ? "Automat pozastavený"
                : active === undefined
                  ? "Plán evidovaný"
                  : due === "today"
                    ? "Dnes k odeslání"
                    : due === "overdue"
                      ? "Čeká na odeslání"
                      : "Naplánováno";
  const tone = blocked
    ? "attention"
    : !invoice || active === undefined
      ? "unknown"
      : due;
  return (
    <li
      ref={rowRef}
      className={styles.companyReminderItem}
      data-attention={blocked}
    >
      <Link
        href={`/invoices/${item.id}`}
        className={styles.companyReminderRow}
        data-tone={tone}
        title={status}
        aria-label={`Zobrazit fakturu ${invoice?.invoice_number ?? item.invoice_number}. ${status}`}
      >
        <i className={styles.companyReminderDot} aria-hidden="true" />
        <span className={styles.companyReminderIdentity}>
          <strong title={invoice?.counterparty_name ?? item.counterparty_name}>
            {invoice?.counterparty_name ?? item.counterparty_name}
          </strong>
          <span
            title={`Faktura ${invoice?.invoice_number ?? item.invoice_number}`}
          >
            Faktura {invoice?.invoice_number ?? item.invoice_number}
          </span>
        </span>
        <span className={styles.companyReminderDate}>
          {date && (!invoice || open) ? (
            <>
              <Icon name="calendar" />
              <time dateTime={date}>{dashboardDate(date)}</time>
            </>
          ) : null}
        </span>
        <strong className={styles.companyReminderAmount} title="Částka faktury">
          <ExactMoney value={Number(invoice?.amount ?? item.amount)} currency={invoice?.currency ?? item.currency} />
        </strong>
        <Icon name="arrow-right" className={styles.companyReminderArrow} />
      </Link>
      {error ? (
        <button
          className={styles.companyReminderRetry}
          type="button"
          title={reminderReadError(error)}
          onClick={() => void mutate()}
        >
          Zkusit znovu
        </button>
      ) : null}
    </li>
  );
}

export function DashboardReminderOverview({
  summary,
  canManage,
  today = todayInTimeZone(new Date()),
}: {
  summary: DashboardPageData;
  canManage: boolean;
  today?: string;
}) {
  // Existing role-protected read endpoint. A viewer never requests settings.
  const {
    data: settings,
    error,
    mutate,
  } = useSWR<{ active: boolean }>(
    canManage ? "/api/settings/reminders" : null,
    fetchReminderRead<{ active: boolean }>,
    { refreshInterval: 60_000 },
  );
  const active =
    canManage && !error && typeof settings?.active === "boolean"
      ? settings.active
      : undefined;
  const seen = new Set<string>();
  const upcoming = [...summary.upcoming]
    .filter(
      (item) =>
        (item.status === "pending" || item.status === "overdue") &&
        item.next_reminder_at &&
        Number.isFinite(Date.parse(item.next_reminder_at)),
    )
    .sort(
      (a, b) =>
        Date.parse(a.next_reminder_at!) - Date.parse(b.next_reminder_at!) ||
        a.id.localeCompare(b.id),
    )
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  return (
    <aside
      className={`${styles.card} ${styles.reminderPanel} ${styles.companyReminders}`}
      aria-labelledby="dashboard-reminders-heading"
      data-empty={upcoming.length === 0}
    >
      <div className={styles.companyReminderContents}>
        <header className={`${styles.cardHeader} ${styles.reminderHeader}`}>
          <h2 id="dashboard-reminders-heading">Nejbližší upomínky</h2>
          <span
            className={styles.sentCount}
            title="Počet odeslaných upomínek k fakturám ve vybraném období"
          >
            {summary.reminders_sent} odesláno
          </span>
        </header>
        {error ? (
          <p className={styles.companyReminderNotice} role="status">
            Stav automatu nelze ověřit.{" "}
            <button
              type="button"
              title={reminderReadError(error)}
              onClick={() => void mutate()}
            >
              Zkusit znovu
            </button>
          </p>
        ) : null}
        {upcoming.length ? (
          <>
            <ul
              className={styles.companyReminderList}
              aria-label="Upomínky podle nejbližšího termínu odeslání"
              tabIndex={0}
              data-reminder-scroll
            >
              {upcoming.map((item, index) => (
                <UpcomingReminder
                  key={item.id}
                  item={item}
                  active={active}
                  today={today}
                  eager={index < 3}
                />
              ))}
            </ul>
          </>
        ) : (
          <p className={styles.companyReminderEmpty}>
            Žádné další upomínky nejsou naplánované.
          </p>
        )}
      </div>
    </aside>
  );
}
