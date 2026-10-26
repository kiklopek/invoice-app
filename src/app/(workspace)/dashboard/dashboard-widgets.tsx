"use client";

import { SummaryMoney } from "@/components/money-amount";
import Link from "next/link";
import { ChevronDown } from "@/components/chevron-down";
import { useRef, type CSSProperties } from "react";
import { Icon, type IconName } from "@/components/icons";
import type { DashboardData } from "@/lib/dashboard-summary";
import type { InvoiceReport } from "@/lib/report-query";
import {
  dashboardMoney,
  dashboardBeforeDue,
  dashboardStatusParts,
  dashboardMonthlyStatuses,
  dashboardTrendGroups,
  type DashboardStatusReports,
} from "./dashboard-presentation";
import styles from "./dashboard-summary.module.css";

export function CurrencyTotals({ totals }: { totals: Record<string, number> }) {
  const entries = Object.entries(totals).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className={styles.currencyTotals}>
      {(entries.length ? entries : [["CZK", 0] as const]).map(
        ([currency, amount]) => (
          <div key={currency}><SummaryMoney value={Number(amount)} currency={currency} /></div>
        ),
      )}
    </div>
  );
}

export function SectionError({
  children,
  retry,
}: {
  children: React.ReactNode;
  retry: () => void;
}) {
  return (
    <div className={styles.sectionError} role="alert">
      <p>{children}</p>
      <button type="button" onClick={retry}>
        Zkusit znovu <span aria-hidden="true">↻</span>
      </button>
    </div>
  );
}

function Count({
  value,
  failed,
}: {
  value: number | undefined;
  failed?: boolean;
}) {
  return value === undefined ? (
    failed ? (
      <span className={styles.unavailable}>Nedostupné</span>
    ) : (
      <span
        className={styles.skeleton}
        aria-label="Načítání počtu faktur"
        role="status"
      />
    )
  ) : (
    <>{new Intl.NumberFormat("cs-CZ").format(value)}</>
  );
}

export function DashboardKpiGrid({
  summary,
  total,
  paidCount,
  totalFailed,
  paidFailed,
  retryCounts,
  countChange,
  comparisonFailed,
  retryComparison,
  allTime = false,
  comparisonTitle,
  invoiceQuery,
}: {
  allTime?: boolean;
  comparisonTitle?: string;
  invoiceQuery?: string;
  summary: DashboardData;
  total: number | undefined;
  paidCount: number | undefined;
  totalFailed: boolean;
  paidFailed: boolean;
  retryCounts: () => void;
  countChange: number | null | undefined;
  comparisonFailed: boolean;
  retryComparison: () => void;
}) {
  const beforeDue = dashboardBeforeDue(summary);
  const metrics: {
    label: string;
    icon: IconName;
    tone: string;
    count: React.ReactNode;
    detail: React.ReactNode;
    note: string;
    href: string;
  }[] = [
    {
      label: "Celkem faktur",
      icon: "document",
      tone: "neutral",
      count: <Count value={total} failed={totalFailed} />,
      detail: allTime ? (
        <span>Za celé období</span>
      ) : comparisonFailed ? (
        <button
          type="button"
          className={styles.comparisonRetry}
          onClick={retryComparison}
        >
          Srovnání nedostupné · opakovat
        </button>
      ) : countChange === undefined ? (
        <span role="status">Načítání srovnání…</span>
      ) : (
        <span
          className={styles.comparison}
          data-direction={
            countChange === null || countChange >= 0 ? "up" : "down"
          }
          title={
            comparisonTitle ??
            "Počet nově vystavených faktur oproti předchozímu období, všechny měny."
          }
        >
          <strong>
            {countChange === null
              ? "Nové období"
              : `${countChange > 0 ? "↑ " : countChange < 0 ? "↓ " : ""}${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(Math.abs(countChange))} %`}
          </strong>
          <small>oproti minule</small>
        </span>
      ),
      note: "Včetně zaplacených a stornovaných",
      href: "/invoices",
    },
    {
      label: "Čeká na splatnost",
      icon: "hourglass",
      tone: "waiting",
      count: beforeDue.count,
      detail: <CurrencyTotals totals={beforeDue.totals} />,
      note: "Nezaplacené, splatné dnes nebo později",
      href: "/invoices?status=pending",
    },
    {
      label: "Po splatnosti",
      icon: "clock",
      tone: "overdue",
      count: summary.overdue_count,
      detail: <CurrencyTotals totals={summary.overdue_totals} />,
      note: "Zbývající částka k úhradě",
      href: "/invoices?status=overdue",
    },
    {
      label: "Zaplaceno",
      icon: "tick",
      tone: "paid",
      count: <Count value={paidCount} failed={paidFailed} />,
      detail: <CurrencyTotals totals={summary.paid_totals} />,
      note: "Částka včetně částečných úhrad",
      href: "/invoices?status=paid",
    },
  ];
  return (
    <section aria-label="Souhrn pohledávek" className={styles.metrics}>
      {metrics.map((metric) => (
        <article
          key={metric.label}
          className={styles.metric}
          data-tone={metric.tone}
          title={metric.note}
        >
          <span className={styles.metricIcon}>
            <Icon name={metric.icon} />
          </span>
          <div className={styles.metricBody}>
            <Link
              className={styles.metricLabel}
              href={
                invoiceQuery
                  ? `${metric.href}${metric.href.includes("?") ? "&" : "?"}${invoiceQuery}`
                  : metric.href
              }
            >
              {metric.label}
            </Link>
            <strong className={styles.metricValue}>{metric.count}</strong>
            <div className={styles.metricDetail}>{metric.detail}</div>
            <small>{metric.note}</small>
          </div>
        </article>
      ))}
      {totalFailed || paidFailed ? (
        <div className={styles.metricRetry}>
          <SectionError retry={retryCounts}>
            Počty faktur se nepodařilo aktualizovat. Peněžní souhrny zůstávají
            dostupné.
          </SectionError>
        </div>
      ) : null}
    </section>
  );
}

export function InvoiceStatusChart({
  summary,
  paidCount,
  failed,
  retry,
}: {
  summary: DashboardData;
  paidCount: number | undefined;
  failed: boolean;
  retry: () => void;
}) {
  const parts = dashboardStatusParts(summary, paidCount);
  const total = parts?.reduce((sum, part) => sum + part.count, 0) ?? 0;
  const segments = parts
    ?.map((part, index) => {
      const start = total
        ? (parts.slice(0, index).reduce((sum, item) => sum + item.count, 0) /
            total) *
          100
        : 0;
      const end = start + (total ? (part.count / total) * 100 : 0);
      return `${part.color} ${start}% ${end}%`;
    })
    .join(", ");
  return (
    <section className={styles.card} aria-labelledby="dashboard-status-heading">
      <header className={styles.cardHeader}>
        <div>
          <h2 id="dashboard-status-heading">Stav faktur</h2>
          <p>Aktuálně · bez stornovaných faktur</p>
        </div>
      </header>
      {failed ? (
        <SectionError retry={retry}>
          Stavy faktur se nepodařilo načíst.
        </SectionError>
      ) : !parts ? (
        <div
          className={styles.chartSkeleton}
          role="status"
          aria-label="Načítání stavů faktur"
        />
      ) : total === 0 ? (
        <div className={styles.emptyChart}>
          Zatím nemáte žádné aktivní ani zaplacené faktury.
        </div>
      ) : (
        <div className={styles.statusChart}>
          <div
            className={styles.donut}
            style={
              {
                "--donut-background": `conic-gradient(${segments})`,
              } as CSSProperties
            }
            aria-hidden="true"
          >
            <div>
              <strong>{new Intl.NumberFormat("cs-CZ").format(total)}</strong>
              <span>faktur</span>
            </div>
          </div>
          <div className={styles.statusLegendWrap}>
            <dl className={styles.statusLegend}>
              {parts.map((part) => (
                <div key={part.key}>
                  <dt>
                    <i style={{ background: part.color }} aria-hidden="true" />
                    {part.label}
                  </dt>
                  <dd>
                    <strong>{part.count}</strong>
                    <span>
                      {new Intl.NumberFormat("cs-CZ", {
                        style: "percent",
                        maximumFractionDigits: 0,
                      }).format(part.count / total)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </section>
  );
}

export function PaymentTrendChart({
  data,
  statusReports,
  loading,
  failed,
  retry,
  currency,
  currencies,
  onCurrencyChange,
}: {
  data: Pick<InvoiceReport, "monthly"> | undefined;
  statusReports: DashboardStatusReports | undefined;
  loading: boolean;
  failed: boolean;
  retry: () => void;
  currency: string;
  currencies: string[];
  onCurrencyChange: (value: string) => void;
}) {
  const tableRef = useRef<HTMLDetailsElement>(null);
  const optionsRef = useRef<HTMLDetailsElement>(null);
  const rows = dashboardMonthlyStatuses(data, statusReports);
  const plotRows = dashboardTrendGroups(rows);
  const maximum = Math.max(1, ...plotRows.map((row) => row.total));
  const monthName = (value: string) =>
    /^\d{4}-\d{2}$/.test(value)
      ? new Intl.DateTimeFormat("cs-CZ", { month: "short" }).format(
          new Date(`${value}-15T12:00:00Z`),
        )
      : value;
  return (
    <section
      className={styles.card}
      aria-labelledby="dashboard-trend-heading"
      aria-busy={loading}
    >
      <header className={styles.cardHeader}>
        <div>
          <h2 id="dashboard-trend-heading">
            <Link href="/reports">Faktury v čase</Link>
          </h2>
          <p>
            Aktuální stav nezrušených faktur podle měsíce vystavení. Uhrazeno
            zahrnuje částečné úhrady; nejde o datum pohybu na účtu.
          </p>
        </div>
        <div className={styles.chartControls}>
          <details
            ref={optionsRef}
            data-dashboard-popup
            className={styles.chartOptions}
          >
            <summary aria-label="Nastavení grafu">
              <Icon name="more" />
            </summary>
            <div data-popup>
              <label>
                Měna grafu
                <select
                  aria-label="Měna grafu"
                  value={currency}
                  onChange={(event) => onCurrencyChange(event.target.value)}
                >
                  {currencies.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  if (tableRef.current) {
                    tableRef.current.open = true;
                    tableRef.current.querySelector("summary")?.focus();
                  }
                  if (optionsRef.current) optionsRef.current.open = false;
                }}
              >
                Zobrazit hodnoty grafu
              </button>
            </div>
          </details>
        </div>
      </header>
      <div className={styles.chartLegend}>
        <span>
          <i className={styles.legendPaid} />
          Uhrazeno
        </span>
        <span>
          <i className={styles.legendPending} />
          Čeká na splatnost
        </span>
        <span>
          <i className={styles.legendOverdue} />
          Po splatnosti
        </span>
      </div>
      <p className={`${styles.chartScope} ${styles.srOnly}`}>
        Období platí pro celý přehled podle data vystavení faktur. Měna mění
        pouze tento graf.
      </p>
      {failed ? (
        <SectionError retry={retry}>
          Graf se nepodařilo načíst. Ostatní přehledy zůstávají dostupné.
        </SectionError>
      ) : loading ? (
        <div
          className={styles.chartSkeleton}
          role="status"
          aria-label="Načítání grafu"
        />
      ) : !rows.length ? (
        <div className={styles.emptyChart}>
          Ve zvoleném období a měně nejsou žádné faktury. Zkuste jiné období
          nebo měnu.
        </div>
      ) : (
        <>
          <div
            className={styles.barChart}
            aria-label={
              plotRows === rows
                ? "Měsíční částky faktur"
                : "Částky faktur za celé období"
            }
          >
            <div className={styles.bars}>
              {plotRows.map((row, index) => (
                <div
                  key={row.key}
                  className={styles.month}
                  tabIndex={0}
                  aria-label={`${row.key}: vystaveno ${dashboardMoney(row.issued, currency)}, uhrazeno bez storen ${dashboardMoney(row.paid, currency)}, čeká na úhradu ${dashboardMoney(row.pending, currency)}, po splatnosti ${dashboardMoney(row.overdue, currency)}`}
                >
                  <span className={styles.chartTooltip} aria-hidden="true">
                    <strong>{row.key}</strong>
                    <span>
                      Vystaveno: {dashboardMoney(Number(row.issued), currency)}
                    </span>
                    <span>
                      Uhrazeno bez storen: {dashboardMoney(row.paid, currency)}
                    </span>
                    <span>
                      Čeká na splatnost: {dashboardMoney(row.pending, currency)}
                    </span>
                    <span>
                      Po splatnosti: {dashboardMoney(row.overdue, currency)}
                    </span>
                  </span>
                  <div className={styles.barTrack}>
                    <span
                      className={styles.paidBar}
                      style={{ height: `${(row.paid / maximum) * 100}%` }}
                    />
                    <span
                      className={styles.pendingBar}
                      style={{
                        bottom: `${(row.paid / maximum) * 100}%`,
                        height: `${(row.pending / maximum) * 100}%`,
                      }}
                    />
                    <span
                      className={styles.overdueBar}
                      style={{
                        bottom: `${((row.paid + row.pending) / maximum) * 100}%`,
                        height: `${(row.overdue / maximum) * 100}%`,
                      }}
                    />
                  </div>
                  <span title={row.key}>
                    {plotRows === rows ||
                    index % Math.ceil(plotRows.length / 8) === 0 ||
                    index === plotRows.length - 1
                      ? monthName(row.key)
                      : "\u00a0"}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <details
            ref={tableRef}
            className={styles.chartTable}
            data-chart-values
          >
            <summary>Zobrazit hodnoty grafu<ChevronDown /></summary>
            <table>
              <caption>
                Původní report a aktuální stav nezrušených faktur podle měsíce
                vystavení v {currency}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Měsíc</th>
                  <th scope="col">Vystaveno</th>
                  <th scope="col">Uhrazeno v reportu</th>
                  <th scope="col">Uhrazeno bez storen</th>
                  <th scope="col">Čeká na splatnost</th>
                  <th scope="col">Po splatnosti</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.key}</th>
                    <td>{dashboardMoney(Number(row.issued), currency)}</td>
                    <td>{dashboardMoney(row.reportPaid, currency)}</td>
                    <td>{dashboardMoney(row.paid, currency)}</td>
                    <td>{dashboardMoney(row.pending, currency)}</td>
                    <td>{dashboardMoney(row.overdue, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
