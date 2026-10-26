"use client";

import { ApiRequestError } from "@/lib/api-client";
import { ExactMoney } from "@/components/money-amount";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { AppFrame } from "@/components/layout/app-shell";
import { Icon } from "@/components/icons";
import { useRevalidateOnRevisit } from "@/lib/revalidate-on-revisit";
import { canManageInvoices } from "@/lib/role-access";
import { useAccessProfile } from "@/lib/use-access-role";
import { todayInTimeZone } from "@/lib/reminders";
import type { DashboardPageData } from "@/lib/dashboard-page-data";
import {
  DashboardKpiGrid,
  InvoiceStatusChart,
  PaymentTrendChart,
  SectionError,
} from "./dashboard-widgets";
import {
  dashboardCountChange,
  dashboardDate,
} from "./dashboard-presentation";
import { DashboardReminderOverview as ReminderOverview } from "./dashboard-reminders";
import styles from "./dashboard-summary.module.css";
import { emptyDashboardData } from "@/lib/dashboard-summary";
import {
  dashboardPeriodRange,
  dashboardPreviousRange,
  dashboardRangeParams,
  type DashboardPeriod,
} from "@/lib/dashboard-period";

const statusLabel = {
  pending: "Čeká na úhradu",
  overdue: "Po splatnosti",
  paid: "Zaplaceno",
  cancelled: "Stornováno",
};

export function DashboardClient({
  initialData,
  initialNow,
}: {
  initialData: DashboardPageData;
  initialNow?: string;
}) {
  const profile = useAccessProfile();
  const role = profile?.role ?? null;
  const canManage = canManageInvoices(role);
  const [now] = useState(() => new Date(initialNow ?? Date.now()));
  useEffect(() => {
    const dismiss = (event: Event) => {
      for (const menu of document.querySelectorAll<HTMLDetailsElement>(
        "details[data-dashboard-popup][open]",
      )) {
        if (event instanceof KeyboardEvent) {
          if (event.key !== "Escape") continue;
          menu.open = false;
          menu.querySelector("summary")?.focus();
        } else if (event.target instanceof Node && !menu.contains(event.target))
          menu.open = false;
      }
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", dismiss);
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, []);
  const [months, setMonths] = useState<DashboardPeriod>("all");
  const [currency, setCurrency] = useState("CZK");
  const today = todayInTimeZone(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      timeZone: "Europe/Prague",
    }).format(now),
  );
  const greeting =
    hour < 11 ? "Dobré ráno" : hour < 18 ? "Dobrý den" : "Dobrý večer";
  const range = dashboardPeriodRange(today, months);
  const rangeParams = dashboardRangeParams(range).toString();
  const summaryKey = `/api/dashboard?${rangeParams}`;
  const fallback =
    initialData.period?.from === range.from &&
    initialData.period?.to === range.to
      ? initialData
      : undefined;
  const revalidateOnRevisit = useRevalidateOnRevisit(summaryKey);
  const {
    data: periodSummary,
    error: summaryError,
    mutate: reloadSummary,
  } = useSWR<DashboardPageData>(summaryKey, {
    fallbackData: fallback,
    revalidateOnMount: !fallback || revalidateOnRevisit,
    keepPreviousData: false,
    refreshInterval: 60_000,
    // Only transient read failures retry; permission failures must stay visible.
    shouldRetryOnError: (error: unknown) =>
      error instanceof ApiRequestError &&
      (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500),
    errorRetryCount: 2,
    errorRetryInterval: 1_500,
  });
  const summary = periodSummary ?? emptyDashboardData;
  const previousRange = dashboardPreviousRange(range);
  const countChange = dashboardCountChange(
    periodSummary?.invoice_count,
    periodSummary?.previous_invoice_count ?? undefined,
  );
  const chart = periodSummary?.charts?.[currency];
  const report = chart ?? { monthly: [] };
  const statusReports = chart?.statuses ?? {
    paid: { monthly: [] }, pending: { monthly: [] }, overdue: { monthly: [] },
  };
  const currencies = [
    ...new Set(["CZK", currency, ...(periodSummary?.currencies ?? [])]),
  ].sort();

  return (
    <AppFrame
      invoiceCount={summary.active_count}
      className={`content ${styles.page}`}
    >
      <header className={styles.heading}>
        <div>
          <p className={styles.date}>
            {new Intl.DateTimeFormat("cs-CZ", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "Europe/Prague",
            }).format(now)}
          </p>
          <h1>
            {greeting}
            {profile?.name ? `, ${profile.name}` : ""}!
          </h1>
          <p>
            {!periodSummary ? (
              "Načítání přehledu za vybrané období…"
            ) : summary.active_count ? (
              <>
                {new Intl.NumberFormat("cs-CZ").format(summary.active_count)}{" "}
                faktur čeká na úplnou úhradu
                {summary.overdue_count
                  ? `, z toho ${summary.overdue_count} po splatnosti`
                  : ""}
                .
              </>
            ) : (
              "Ve vybraném období nemáte neuhrazené faktury."
            )}
          </p>
        </div>
        <div className={styles.headingActions}>
          <label className={styles.periodControl}>
            <span className={styles.srOnly}>Období dashboardu</span>
            <Icon name="calendar" />
            <select
              value={months}
              onChange={(event) =>
                setMonths(
                  event.target.value === "all"
                    ? "all"
                    : (Number(event.target.value) as 3 | 6 | 12),
                )
              }
            >
              <option value={3}>Poslední 3 měsíce</option>
              <option value={6}>Posledních 6 měsíců</option>
              <option value={12}>Posledních 12 měsíců</option>
              <option value="all">Za celé období</option>
            </select>
          </label>
        </div>
      </header>
      {summaryError ? (
        <SectionError
          retry={() => {
            void reloadSummary();
          }}
        >
          Přehled se nepodařilo aktualizovat. Zkuste načtení zopakovat.
        </SectionError>
      ) : null}
      {periodSummary ? (
        <>
          {periodSummary?.invoice_count === 0 ? (
            <section className={styles.welcome}>
              <Icon name="document" />
              <div>
                <h2>V tomto období nejsou žádné faktury</h2>
                <p>
                  {canManage
                    ? "Vyberte jiné období nebo přidejte fakturu."
                    : "Zkuste vybrat jiné období."}
                </p>
              </div>
            </section>
          ) : null}
          <DashboardKpiGrid
            countChange={countChange}
            allTime={months === "all"}
            invoiceQuery={rangeParams}
            comparisonTitle={
              previousRange
                ? `Počet vystavených faktur od ${dashboardDate(range.from!)} do ${dashboardDate(range.to)} oproti stejně dlouhému předchozímu období, všechny měny.`
                : undefined
            }
            comparisonFailed={Boolean(summaryError)}
            retryComparison={() => {
              void reloadSummary();
            }}
            summary={summary}
            total={periodSummary?.invoice_count}
            paidCount={periodSummary?.paid_invoice_count}
            totalFailed={Boolean(summaryError)}
            paidFailed={Boolean(summaryError)}
            retryCounts={() => {
              void reloadSummary();
            }}
          />
          <section className={styles.charts} aria-label="Grafy faktur">
            <PaymentTrendChart
              data={report}
              statusReports={statusReports}
              loading={!periodSummary}
              failed={Boolean(summaryError)}
              retry={() => {
                void reloadSummary();
              }}
              currency={currency}
              currencies={currencies}
              onCurrencyChange={setCurrency}
            />
            <InvoiceStatusChart
              summary={summary}
              paidCount={periodSummary?.paid_invoice_count}
              failed={Boolean(summaryError)}
              retry={() => {
                void reloadSummary();
              }}
            />
          </section>
          <div className={styles.lists}>
            <RecentInvoices
              invoices={summary.recent}
              invoiceQuery={rangeParams}
            />
            <ReminderOverview
              summary={summary}
              canManage={canManage}
              today={today}
            />
          </div>
        </>
      ) : !summaryError ? (
        <p role="status">Načítání dat za vybrané období…</p>
      ) : null}
    </AppFrame>
  );
}

function RecentInvoices({
  invoices,
  invoiceQuery,
}: {
  invoiceQuery: string;
  invoices: DashboardPageData["recent"];
}) {
  const router = useRouter();
  const preview = invoices.slice(0, 5);
  const badges = (invoice: DashboardPageData["recent"][number]) => {
    const partial =
      (invoice.status === "pending" || invoice.status === "overdue") &&
      Number(invoice.paid_amount) > 0;
    return (
      <span
        className={styles.statuses}
        title={`${statusLabel[invoice.status]}${partial ? " · Částečně uhrazeno" : ""}`}
      >
        <span className={styles.status} data-status={invoice.status}>
          {partial ? "Částečně uhrazeno" : statusLabel[invoice.status]}
        </span>
      </span>
    );
  };
  return (
    <section
      className={styles.card}
      aria-labelledby="dashboard-invoices-heading"
    >
      <header className={styles.cardHeader}>
        <div>
          <h2 id="dashboard-invoices-heading">Poslední faktury</h2>
        </div>
        <Link className={styles.textLink} href={`/invoices?${invoiceQuery}`}>
          Zobrazit všechny <Icon name="arrow-right" />
        </Link>
      </header>
      {!invoices.length ? (
        <div className={styles.emptyList}>
          Ve vybraném období nejsou žádné evidované faktury.
        </div>
      ) : (
        <>
          <div className={styles.invoiceTable}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Faktura</th>
                  <th scope="col">Odběratel</th>
                  <th scope="col">Částka</th>
                  <th scope="col">Splatnost</th>
                  <th scope="col">Stav</th>
                  <th scope="col">
                    <span className={styles.srOnly}>Akce</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.map((invoice) => (
                  <tr
                    key={invoice.id}
                    onClick={(event) => {
                      if (window.getSelection()?.toString()) return;
                      if (
                        event.target instanceof HTMLElement &&
                        event.target.closest(
                          "a, button, input, select, textarea, summary, details",
                        )
                      )
                        return;
                      router.push(`/invoices/${invoice.id}`);
                    }}
                  >
                    <td
                      title={`Variabilní symbol: ${invoice.variable_symbol || "—"}`}
                    >
                      <Link href={`/invoices/${invoice.id}`}>
                        {invoice.invoice_number}
                      </Link>
                      <small>VS {invoice.variable_symbol || "—"}</small>
                    </td>
                    <td title={invoice.counterparty_email || undefined}>
                      <strong>{invoice.counterparty_name}</strong>
                      <small>{invoice.counterparty_email}</small>
                    </td>
                    <td className={styles.amount}>
                      <ExactMoney value={Number(invoice.amount)} currency={invoice.currency} />
                    </td>
                    <td
                      title={`${invoice.reminders_sent}× upomínka`}
                      className={
                        invoice.status === "overdue"
                          ? styles.overdueDate
                          : undefined
                      }
                    >
                      {dashboardDate(invoice.due_date)}
                      <small>{invoice.reminders_sent}× upomínka</small>
                    </td>
                    <td>{badges(invoice)}</td>
                    <td>
                      <InvoiceActions
                        id={invoice.id}
                        number={invoice.invoice_number}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            className={styles.invoiceCards}
            role="list"
            aria-label="Poslední faktury"
          >
            {preview.map((invoice) => (
              <article
                className={styles.invoiceCard}
                key={invoice.id}
                role="listitem"
              >
                <header>
                  <Link href={`/invoices/${invoice.id}`}>
                    {invoice.invoice_number}
                  </Link>
                </header>
                <strong>{invoice.counterparty_name}</strong>
                <span>{invoice.counterparty_email}</span>
                <div className={styles.invoiceCardAmount}>
                  <ExactMoney value={Number(invoice.amount)} currency={invoice.currency} />
                </div>
                <footer>
                  {invoice.reminders_sent > 0 && <span className={styles.invoiceCardReminders}>{invoice.reminders_sent}× upomínka</span>}
                </footer>
                <div className={styles.invoiceCardSide}>
                  {badges(invoice)}
                  <small>VS {invoice.variable_symbol || "—"}</small>
                  <span className={styles.invoiceCardDue}>
                    <span>Splatnost</span>
                    <time dateTime={invoice.due_date}>{dashboardDate(invoice.due_date)}</time>
                  </span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function InvoiceActions({ id, number }: { id: string; number: string }) {
  const [notice, setNotice] = useState("");
  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error();
      await navigator.clipboard.writeText(number);
      setNotice("Zkopírováno");
    } catch {
      setNotice("Číslo můžete označit a zkopírovat z řádku.");
    }
  }
  return (
    <details data-dashboard-popup className={styles.invoiceActions}>
      <summary aria-label={`Akce faktury ${number}`}>
        <Icon name="more" />
      </summary>
      <div data-popup>
        <Link href={`/invoices/${id}`}>Otevřít detail faktury</Link>
        <button type="button" onClick={() => void copy()}>
          Kopírovat číslo faktury
        </button>
        {notice ? <span role="status">{notice}</span> : null}
      </div>
    </details>
  );
}
