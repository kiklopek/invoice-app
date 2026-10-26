"use client";

import { SummaryMoney, ExactMoney } from "@/components/money-amount";
import { CloseIcon } from "@/components/close-icon";
import { ChevronDown } from "@/components/chevron-down";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import useSWR from "swr";
import { AppFrame } from "@/components/layout/app-shell";
import { Icon } from "@/components/icons";
import { useSmallMobile } from "@/components/layout/mobile-header-slot";
import { MobileReportControls, ReportSheet } from "./report-mobile-controls";
import { Modal } from "@/components/modal";
import { todayInTimeZone } from "@/lib/reminders";
import type { ReportDateBasis } from "@/lib/report-query";
import type { ReportPageData } from "@/lib/report-page-data";
import { useAccessProfile } from "@/lib/use-access-role";
import {
  revenueRanking,
  vatMetrics,
  reportPresetRange,
} from "@/lib/report-presentation";
import { compactMoneyLabel } from "@/lib/money-display";
import type { InvoiceStatus } from "@/types/invoice";
import { FinancialReportExport } from "@/components/financial-report/financial-report-export";
import styles from "./reports.module.css";

const money = (value: number, currency: string) =>
  new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
const statusNames: Record<InvoiceStatus, string> = {
  pending: "Čeká",
  overdue: "Po splatnosti",
  paid: "Zaplaceno",
  cancelled: "Storno",
};
type ReportTab = "revenue" | "vat" | "receivables" | "payments";
const reportTabs: { id: ReportTab; label: string }[] = [
  { id: "revenue", label: "Tržby" },
  { id: "vat", label: "DPH" },
  { id: "receivables", label: "Pohledávky" },
  { id: "payments", label: "Platby" },
];
const dateBasisNames: Record<ReportDateBasis, string> = {
  issue_date: "Datum vystavení",
  due_date: "Datum splatnosti",
  paid_at: "Datum úplné úhrady",
};
const subtitles: Record<ReportTab, string> = {
  revenue: "Přehled fakturace a evidovaných úhrad vybraných faktur.",
  vat: "Přehled DPH a daňových základů evidovaných faktur.",
  receivables: "Současné zůstatky vybraných faktur a jejich splatnost.",
  payments: "Přehled zaúčtovaných bankovních výpisů a způsobu posouzení řádků.",
};
const displayDate = (value: string) =>
  value
    ? new Intl.DateTimeFormat("cs-CZ").format(new Date(`${value}T12:00:00`))
    : "—";
const monthLabel = (key: string) =>
  new Intl.DateTimeFormat("cs-CZ", { month: "short", year: "2-digit" }).format(
    new Date(`${key}-01T12:00:00`),
  );
const greens = ["#08794c", "#399c70", "#7abb97", "#b0d6bf", "#d9e9df"];
const risks = ["#8fbea4", "#e5bb32", "#ec9a36", "#dc7139", "#c44b48"];

function Metric({
  label,
  value,
  note,
  danger = false,
}: {
  label: string;
  value: string | number | { amount: number; currency: string };
  note: string;
  danger?: boolean;
}) {
  return (
    <article className={styles.metric}>
      <span>{label}</span>
      {typeof value === "object" ? (
        <SummaryMoney
          value={value.amount}
          currency={value.currency}
          danger={danger}
        />
      ) : (
        <strong data-danger={danger || undefined} title={String(value)}>
          {value}
        </strong>
      )}
      <small>{note}</small>
    </article>
  );
}
function Card({
  title,
  subtitle,
  children,
  action,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <article className={`${styles.card} ${className}`}>
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </article>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}
function ReportNote({
  children,
  title,
  className = styles.help,
}: {
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  const mobile = useSmallMobile();
  if (mobile && !title) return null;
  return mobile ? (
    <details className={styles.mobileNote}>
      <summary>
        <span aria-hidden="true">ⓘ</span>
        {title}
        <ChevronDown />
      </summary>
      <div>{children}</div>
    </details>
  ) : (
    <p className={className}>{children}</p>
  );
}

function Distribution({
  rows,
  totalLabel,
  description,
}: {
  rows: { label: string; value: number; color: string; detail: string }[];
  totalLabel: string;
  description: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const valid = total > 0 && rows.every((row) => row.value >= 0);
  let offset = 0;
  const stops = valid
    ? rows
        .map((row) => {
          const start = offset;
          offset += (row.value / total) * 100;
          return `${row.color} ${start}% ${offset}%`;
        })
        .join(",")
    : "";
  return (
    <div className={styles.distribution}>
      {valid && (
        <div
          className={styles.donut}
          role="img"
          aria-label={`${description}: ${rows.map((row) => `${row.label}, ${row.detail}`).join("; ")}`}
          style={{ background: `conic-gradient(${stops})` }}
        >
          <div>
            <strong>{totalLabel}</strong>
            <small>{description}</small>
          </div>
        </div>
      )}
      <ul className={styles.legend}>
        {rows.map((row) => (
          <li key={row.label}>
            <span className={styles.dot} style={{ background: row.color }} />
            <div>
              <span>{row.label}</span>
              <small>{row.detail}</small>
            </div>
            <strong>
              {valid
                ? `${((row.value / total) * 100).toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} %`
                : "—"}
            </strong>
          </li>
        ))}
      </ul>
      {!valid && (
        <ReportNote>
          Podíly se při nulovém nebo záporném základu nezobrazují.
        </ReportNote>
      )}
    </div>
  );
}
function Columns({
  rows,
  first,
  second,
  format,
  colors = ["#a9cfb6", "#08794c"],
}: {
  rows: { key: string; a: number; b: number }[];
  first: string;
  second: string;
  format: (value: number) => string;
  colors?: [string, string];
}) {
  const mobile = useSmallMobile();
  const [selected, setSelected] = useState<(typeof rows)[number] | null>(null);
  const chartId = useId();
  const max = Math.max(
    1,
    ...rows.flatMap((row) => [Math.abs(row.a), Math.abs(row.b)]),
  );
  return (
    <>
      <div className={styles.chartLegend}>
        <span>
          <i style={{ background: colors[0] }} />
          {first}
        </span>
        <span>
          <i style={{ background: colors[1] }} />
          {second}
        </span>
      </div>
      <div className={styles.plot}>
        <div className={styles.axis} aria-hidden="true">
          {[1, 0.75, 0.5, 0.25, 0].map((fraction) => (
            <span key={fraction}>
              {new Intl.NumberFormat("cs-CZ", {
                notation: "compact",
                maximumFractionDigits: mobile ? 0 : 1,
              }).format(max * fraction)}
            </span>
          ))}
        </div>
        <div className={styles.chartScroll}>
          <div
            className={styles.chart}
            style={{
              minWidth: mobile
                ? Math.max(0, rows.length * 28)
                : Math.max(260, rows.length * 58),
            }}
          >
            {rows.map((row) => (
              <div
                className={styles.column}
                key={row.key}
                tabIndex={0}
                role={mobile ? "button" : undefined}
                onClick={
                  mobile
                    ? (event) => {
                        event.currentTarget.focus({ preventScroll: true });
                        setSelected(row);
                      }
                    : undefined
                }
                onKeyDown={
                  mobile
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelected(row);
                        }
                      }
                    : undefined
                }
                aria-label={`${monthLabel(row.key)}: ${first} ${format(row.a)}, ${second} ${format(row.b)}`}
              >
                <div className={styles.tooltip} role="tooltip">
                  <strong>{monthLabel(row.key)}</strong>
                  <span>
                    {first}: {format(row.a)}
                  </span>
                  <span>
                    {second}: {format(row.b)}
                  </span>
                </div>
                <div className={styles.bars}>
                  <i
                    data-negative={row.a < 0 || undefined}
                    style={{
                      height: `${(Math.abs(row.a) / max) * 100}%`,
                      background: row.a < 0 ? undefined : colors[0],
                    }}
                  />
                  <i
                    data-negative={row.b < 0 || undefined}
                    style={{
                      height: `${(Math.abs(row.b) / max) * 100}%`,
                      background: row.b < 0 ? undefined : colors[1],
                    }}
                  />
                </div>
                <span title={monthLabel(row.key)}>
                  {mobile
                    ? new Intl.DateTimeFormat("cs-CZ", {
                        month: "short",
                      }).format(new Date(`${row.key}-01T12:00:00`))
                    : monthLabel(row.key)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {mobile && (
        <ReportSheet
          open={selected !== null}
          onClose={() => setSelected(null)}
          title={selected ? monthLabel(selected.key) : "Hodnoty grafu"}
        >
          {selected && (
            <dl className={styles.chartValues} id={chartId}>
              <div>
                <dt>{first}</dt>
                <dd>{format(selected.a)}</dd>
              </div>
              <div>
                <dt>{second}</dt>
                <dd>{format(selected.b)}</dd>
              </div>
            </dl>
          )}
        </ReportSheet>
      )}
      {rows.some((row) => row.a < 0 || row.b < 0) && (
        <ReportNote>
          Šrafované sloupce označují velikost záporných částek; přesná hodnota
          je dostupná při najetí nebo zaměření klávesnicí.
        </ReportNote>
      )}
    </>
  );
}

export function ReportsClient({
  initialData,
  initialFrom,
  initialTo,
  initialGeneratedAt: _initialGeneratedAt,
}: {
  initialData: ReportPageData;
  initialFrom: string;
  initialTo: string;
  initialGeneratedAt: string;
}) {
  const profile = useAccessProfile();
  const mobile = useSmallMobile();
  const [expandedMetrics, setExpandedMetrics] = useState(false);
  const [from, setFrom] = useState(initialFrom),
    [to, setTo] = useState(initialTo);
  const [currency, setCurrency] = useState("CZK");
  const [status, setStatus] = useState<"all" | InvoiceStatus>("all");
  const [customer, setCustomer] = useState("all");
  const [dateBasis, setDateBasis] = useState<ReportDateBasis>("issue_date");
  const [activeTab, setActiveTab] = useState<ReportTab>("revenue");
  const [exporting, setExporting] = useState(false),
    [error, setError] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomers, setShowCustomers] = useState(false),
    [showDebtors, setShowDebtors] = useState(false);
  const fromInput = useRef<HTMLInputElement>(null);
  const exportingRef = useRef(false);
  const payments = activeTab === "payments";
  const datesValid = Boolean(from && to && from <= to);
  function requestParams(format?: "xlsx") {
    const params = new URLSearchParams({
      from,
      to,
      date_basis: dateBasis,
      currency,
    });
    if (status !== "all") params.set("status", status);
    if (customer !== "all") params.set("customer", customer);
    if (format) params.set("format", format);
    return params;
  }
  const reportKey = `/api/reports?${requestParams()}`;
  const initialKey = `/api/reports?${new URLSearchParams({ from: initialFrom, to: initialTo, date_basis: "issue_date", currency: "CZK" })}`;
  const {
    data: report,
    error: loadError,
    isValidating,
    mutate,
  } = useSWR<ReportPageData>(datesValid ? reportKey : null, {
    fallbackData: reportKey === initialKey ? initialData : undefined,
    revalidateOnMount: reportKey !== initialKey,
    keepPreviousData: false,
  });
  const loading = !report || isValidating;
  const ready = datesValid && !loadError && !loading;
  function preset(type: "month" | "quarter" | "year") {
    const range = reportPresetRange(type, todayInTimeZone());
    setFrom(range.from);
    setTo(range.to);
  }
  function moveReportTab(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 3
          : (index + (event.key === "ArrowRight" ? 1 : 3)) % 4;
    setActiveTab(reportTabs[next].id);
    document.getElementById(`report-tab-${reportTabs[next].id}`)?.focus();
  }
  async function exportExcel() {
    if (exportingRef.current || !ready) return;
    exportingRef.current = true;
    setExporting(true);
    setError("");
    try {
      const response = await fetch(`/api/reports?${requestParams("xlsx")}`);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Export se nepodařilo připravit.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `report-${from}-${to}-${currency}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Export se nepodařilo připravit.",
      );
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }
  const ranking = report ? revenueRanking(report) : null;
  const vat = report ? vatMetrics(report) : null;
  const amount = (value: number) => money(value, currency);
  const metricAmount = (value: number) => ({ amount: value, currency });
  const compactAmount = (value: number) => compactMoneyLabel(value, currency);
  const selectedStatus =
    status === "all" ? "Všechny stavy" : statusNames[status];
  const today = todayInTimeZone();
  const customers = [
    ...new Set([
      ...(report?.customers ?? initialData.customers),
      ...(customer !== "all" ? [customer] : []),
    ]),
  ];
  const normalizeSearch = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("cs-CZ")
      .trim();
  const visibleCustomers = customers.filter((name) =>
    normalizeSearch(name).includes(normalizeSearch(customerSearch)),
  );
  const customerTotals = new Map(
    (report?.customer_concentration ?? [])
      .filter((row, index) => !(index >= 10 && row.name === "Ostatní"))
      .map((row) => [row.name, row]),
  );
  const currencies = [
    ...new Set([currency, ...(report?.currencies ?? initialData.currencies)]),
  ];
  const allDebtors = report?.debtors ?? [];
  const metricsToggle = mobile && (
    <button
      type="button"
      className={styles.metricsToggle}
      aria-expanded={expandedMetrics}
      onClick={() => setExpandedMetrics((value) => !value)}
    >
      {expandedMetrics ? "Skrýt další ukazatele" : "Další ukazatele"}
      <ChevronDown />
    </button>
  );

  return (
    <AppFrame className={`content section-page ${styles.frame}`}>
      <div className={`${styles.page} report-screen-document`}>
        <header className={`${styles.heading} report-screen-header`}>
          <div>
            <h1>{reportTabs.find((tab) => tab.id === activeTab)?.label}</h1>
            <p>{subtitles[activeTab]}</p>
          </div>
          <FinancialReportExport
            query={{
              from,
              to,
              currency,
              dateBasis,
              status: status === "all" ? null : status,
              customer: customer === "all" ? null : customer,
            }}
            currencies={currencies}
            customers={customers}
            ready={ready}
            exporting={exporting}
            onExcel={exportExcel}
          />
        </header>
        <nav
          className={styles.tabs}
          role="tablist"
          aria-label="Části účetního reportu"
        >
          {reportTabs.map((tab, index) => (
            <button
              id={`report-tab-${tab.id}`}
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`report-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => moveReportTab(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        {mobile ? (
          <MobileReportControls
            value={{ from, to, currency, status, customer, dateBasis }}
            defaults={{
              from: initialFrom,
              to: initialTo,
              currency: "CZK",
              status: "all",
              customer: "all",
              dateBasis: "issue_date",
            }}
            today={today}
            payments={payments}
            customers={customers}
            currencies={currencies}
            onApply={(next) => {
              setFrom(next.from);
              setTo(next.to);
              if (!payments) {
                setCurrency(next.currency);
                setStatus(next.status);
                setCustomer(next.customer);
                setDateBasis(next.dateBasis);
              }
            }}
          />
        ) : (
          <section
            className={styles.filters}
            aria-label="Období a filtry reportu"
          >
            <div className={styles.filterTop}>
              <div
                className={styles.presets}
                role="group"
                aria-label="Rychlá volba období"
              >
                {(
                  [
                    ["month", "Tento měsíc"],
                    ["quarter", "Toto čtvrtletí"],
                    ["year", "Tento rok"],
                  ] as const
                ).map(([key, label]) => {
                  const range = reportPresetRange(key, today);
                  return (
                    <button
                      key={key}
                      aria-pressed={from === range.from && to === range.to}
                      onClick={() => preset(key)}
                    >
                      {label}
                    </button>
                  );
                })}
                <button onClick={() => fromInput.current?.focus()}>
                  Vlastní období
                </button>
              </div>
              <div className={styles.dateRange}>
                <label>
                  Od
                  <input
                    ref={fromInput}
                    type="date"
                    value={from}
                    max={to}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
                <span aria-hidden="true">–</span>
                <label>
                  Do
                  <input
                    type="date"
                    value={to}
                    min={from}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>
              </div>
            </div>
            {payments ? (
              <p className={styles.scope}>
                Období podle zaúčtování výpisu; nespárované podle dne bankovního
                zaúčtování platby. Celá firma, všechny měny. Fakturové filtry se
                zde neuplatní.
              </p>
            ) : (
              <details className={styles.more}>
                <summary>
                  Další filtry{" "}
                  <span>
                    {dateBasisNames[dateBasis]} · {currency} · {selectedStatus}
                  </span>
                  <ChevronDown />
                </summary>
                <div className={styles.detailFilters}>
                  <label>
                    Období podle
                    <select
                      aria-label="Období podle"
                      value={dateBasis}
                      onChange={(e) =>
                        setDateBasis(e.target.value as ReportDateBasis)
                      }
                    >
                      {Object.entries(dateBasisNames).map(([key, label]) => (
                        <option value={key} key={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Měna
                    <select
                      aria-label="Měna"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                    >
                      {currencies.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Stav
                    <select
                      aria-label="Stav"
                      value={status}
                      onChange={(e) =>
                        setStatus(e.target.value as typeof status)
                      }
                    >
                      <option value="all">Všechny stavy</option>
                      {Object.entries(statusNames).map(([key, label]) => (
                        <option value={key} key={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Odběratel
                    <select
                      aria-label="Odběratel"
                      value={customer}
                      onChange={(e) => setCustomer(e.target.value)}
                    >
                      <option value="all">Všichni odběratelé</option>
                      {customers.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </details>
            )}
            {!payments && customer !== "all" && (
              <div
                className={styles.activeFilters}
                role="group"
                aria-label="Aktivní filtry"
              >
                <span className={styles.filterChip}>
                  <span>
                    Odběratel: <strong>{customer}</strong>
                  </span>
                  <button
                    type="button"
                    aria-label="Zrušit filtr odběratele"
                    title="Zobrazit všechny odběratele"
                    onClick={() => setCustomer("all")}
                  >
                    <CloseIcon width="14" height="14" />
                  </button>
                </span>
              </div>
            )}
          </section>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
            <button onClick={() => setError("")}>Zavřít</button>
          </p>
        )}
        {!datesValid ? (
          <p role="alert" className={styles.error}>
            Vyberte platné datum od a do.
          </p>
        ) : loadError ? (
          <div role="alert" className={styles.error}>
            Report se nepodařilo načíst.
            <button onClick={() => void mutate()}>Zkusit znovu</button>
          </div>
        ) : !ready || !report || !ranking || !vat ? (
          <div role="status" className={styles.loading}>
            Připravuji report…
            <div />
            <div />
          </div>
        ) : (
          <>
            <section
              id={`report-panel-${activeTab}`}
              role="tabpanel"
              aria-labelledby={`report-tab-${activeTab}`}
              className={styles.panel}
            >
              {activeTab === "revenue" && (
                <>
                  <div
                    className={styles.metrics}
                    data-expanded={expandedMetrics || undefined}
                    data-report={activeTab}
                    role="group"
                    aria-label="Souhrn reportu"
                    tabIndex={0}
                  >
                    <Metric
                      label="Fakturováno"
                      value={metricAmount(Number(report.total))}
                      note={`${report.invoice_count} faktur · s DPH${report.counts.cancelled ? " · včetně storna" : ""}`}
                    />
                    <Metric
                      label="Evidované úhrady"
                      value={metricAmount(Number(report.paid))}
                      note="K vybraným fakturám, bez storna"
                    />
                    <Metric
                      label="Otevřené pohledávky"
                      value={metricAmount(Number(report.open))}
                      note={`Současný zůstatek · ${report.counts.pending + report.counts.overdue} faktur`}
                    />
                    <Metric
                      label="Průměrná faktura"
                      value={
                        report.invoice_count
                          ? metricAmount(
                              Number(report.total) / report.invoice_count,
                            )
                          : "—"
                      }
                      note={`Celkem / ${report.invoice_count} vybraných faktur`}
                    />
                  </div>
                  {metricsToggle}
                  <div className={styles.mainGrid}>
                    <Card
                      title="Fakturace a evidované úhrady"
                      subtitle="Oba sloupce podle měsíce vystavení vybraných faktur."
                      className={styles.revenueChart}
                    >
                      {dateBasis === "issue_date" && report.monthly.length ? (
                        <Columns
                          rows={report.monthly.map((row) => ({
                            key: row.key,
                            a: Number(row.issued),
                            b: Number(row.paid),
                          }))}
                          first="Fakturováno"
                          second="Evidované úhrady"
                          format={amount}
                        />
                      ) : (
                        <Empty>
                          {dateBasis !== "issue_date"
                            ? "Měsíční graf je dostupný při výběru podle data vystavení. Souhrn výše respektuje zvolené datumové pole."
                            : "Ve vybraném období nejsou žádné faktury."}
                        </Empty>
                      )}
                      <ReportNote>
                        Úhrady jsou aktuálně evidované částky; nejde o peněžní
                        tok během období. Fakturace zahrnuje všechny vybrané
                        stavy.
                      </ReportNote>
                    </Card>
                    <Card
                      title="Tržby podle odběratelů"
                      subtitle="Top 5 · podíl na fakturaci s DPH"
                    >
                      {ranking.top.length ? (
                        <div className={styles.ranking}>
                          {ranking.top.map((row) => (
                            <button
                              key={row.name}
                              onClick={() => setCustomer(row.name)}
                            >
                              <span>{row.name}</span>
                              <strong>
                                <ExactMoney
                                  value={Number(row.revenue)}
                                  currency={currency}
                                />
                              </strong>
                              <i>
                                <b
                                  style={{
                                    width: `${ranking.total > 0 ? Math.min(100, Math.max(0, (Number(row.revenue) / ranking.total) * 100)) : 0}%`,
                                  }}
                                />
                              </i>
                              <small>
                                {ranking.total > 0
                                  ? `${((Number(row.revenue) / ranking.total) * 100).toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} %`
                                  : "—"}
                              </small>
                            </button>
                          ))}
                          {report.customer_concentration.length > 5 && (
                            <ReportNote>
                              Zbývající odběratelé:{" "}
                              <ExactMoney
                                value={ranking.other}
                                currency={currency}
                              />
                            </ReportNote>
                          )}
                        </div>
                      ) : (
                        <Empty>Ve výběru nejsou žádní odběratelé.</Empty>
                      )}
                      <button
                        className={styles.textButton}
                        aria-haspopup="dialog"
                        onClick={() => {
                          setCustomerSearch("");
                          setShowCustomers(true);
                        }}
                      >
                        Přehled odběratelů <span aria-hidden="true">→</span>
                      </button>
                    </Card>
                  </div>
                  <details
                    className={`${styles.extra} ${styles.compactDisclosure}`}
                  >
                    <summary>
                      Další přehledy a metodika
                      <ChevronDown className={styles.disclosureArrow} />
                    </summary>
                    <p>
                      Fakturováno a průměr zahrnují storna, pokud jsou ve
                      výběru. Otevřené pohledávky jsou dnešní zůstatky pouze
                      vybraných faktur. Datum úplné úhrady neobsahuje data
                      jednotlivých částečných plateb.
                    </p>
                    <div className={styles.tableScroll}>
                      <table>
                        <caption>
                          Meziroční srovnání podle vystavení (i při jiném
                          datumovém filtru)
                        </caption>
                        <thead>
                          <tr>
                            <th>Měsíc</th>
                            <th>Aktuální období</th>
                            <th>O rok dříve</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.yoy_monthly.map((row) => (
                            <tr key={row.month}>
                              <td>{row.month}</td>
                              <td>
                                <ExactMoney
                                  value={Number(row.current_year)}
                                  currency={currency}
                                />
                              </td>
                              <td>
                                <ExactMoney
                                  value={Number(row.prior_year)}
                                  currency={currency}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              )}
              {activeTab === "vat" && (
                <>
                  <div
                    className={styles.metrics}
                    data-expanded={expandedMetrics || undefined}
                    data-report={activeTab}
                    role="group"
                    aria-label="Souhrn reportu"
                    tabIndex={0}
                  >
                    <Metric
                      label={
                        vat.main
                          ? `Základ daně ${vat.main.vat_rate} %`
                          : "Základ daně"
                      }
                      value={
                        vat.main ? metricAmount(Number(vat.main.base)) : "—"
                      }
                      note="Sazba s největším objemem fakturace"
                    />
                    <Metric
                      label={vat.main ? `DPH ${vat.main.vat_rate} %` : "DPH"}
                      value={
                        vat.main ? metricAmount(Number(vat.main.tax)) : "—"
                      }
                      note="Evidovaná daň vybraných faktur"
                    />
                    <Metric
                      label="Základ ostatních sazeb"
                      value={metricAmount(vat.otherBase)}
                      note={`${Math.max(0, report.vat_breakdown.length - 1)} dalších sazeb`}
                    />
                    <Metric
                      label="Celkem fakturováno"
                      value={metricAmount(Number(report.total))}
                      note={`${report.invoice_count} faktur · s DPH`}
                    />
                  </div>
                  {metricsToggle}
                  <div className={styles.mainGrid}>
                    <Card
                      title="Rozpis DPH podle sazeb"
                      subtitle={`${dateBasisNames[dateBasis]} · ${currency}`}
                    >
                      <div
                        className={`${styles.tableScroll} ${styles.vatTable}`}
                      >
                        <table>
                          <thead>
                            <tr>
                              <th>Sazba</th>
                              <th>Základ daně</th>
                              <th>DPH</th>
                              <th>Celkem</th>
                              <th>Faktur</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.vat_breakdown.map((row) => (
                              <tr key={row.vat_rate}>
                                <td>
                                  <strong>{row.vat_rate} %</strong>
                                </td>
                                <td>
                                  <ExactMoney
                                    value={Number(row.base)}
                                    currency={currency}
                                  />
                                </td>
                                <td>
                                  <ExactMoney
                                    value={Number(row.tax)}
                                    currency={currency}
                                  />
                                </td>
                                <td>
                                  <ExactMoney
                                    value={Number(row.gross)}
                                    currency={currency}
                                  />
                                </td>
                                <td>{row.count}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr>
                              <th>Celkem</th>
                              <td>
                                <ExactMoney
                                  value={vat.base}
                                  currency={currency}
                                />
                              </td>
                              <td>
                                <ExactMoney
                                  value={vat.tax}
                                  currency={currency}
                                />
                              </td>
                              <td>
                                <ExactMoney
                                  value={Number(report.total)}
                                  currency={currency}
                                />
                              </td>
                              <td>{report.invoice_count}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      {mobile && report.vat_breakdown.length > 0 && (
                        <details className={styles.mobileNote}>
                          <summary>
                            Částky s DPH a počty faktur
                            <ChevronDown />
                          </summary>
                          <dl className={styles.vatDetails}>
                            {report.vat_breakdown.map((row) => (
                              <div key={row.vat_rate}>
                                <dt>{row.vat_rate} %</dt>
                                <dd>
                                  <ExactMoney
                                    value={Number(row.gross)}
                                    currency={currency}
                                  />{" "}
                                  · {row.count} faktur
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      )}
                      {!report.vat_breakdown.length && (
                        <Empty>
                          Ve vybraném období nejsou evidované sazby DPH.
                        </Empty>
                      )}
                    </Card>
                    <Card
                      title="Podíl podle sazeb"
                      subtitle="Podíl na celkové částce s DPH"
                    >
                      <Distribution
                        rows={report.vat_breakdown.map((row, index) => ({
                          label: `${row.vat_rate} %`,
                          value: Number(row.gross),
                          color: greens[index % greens.length],
                          detail: `Základ ${amount(Number(row.base))} · DPH ${amount(Number(row.tax))} · ${row.count} faktur`,
                        }))}
                        totalLabel={compactAmount(Number(report.total))}
                        description="fakturováno s DPH"
                      />
                    </Card>
                  </div>
                  <ReportNote className={styles.info}>
                    <span aria-hidden="true">ⓘ</span>
                    {profile?.vatPayer === false
                      ? "Firma je nastavena jako neplátce DPH. "
                      : ""}
                    Orientační přehled evidovaných faktur, jedna sazba na
                    fakturu, bez DUZP a odpočtů. Nejde o daňové přiznání.{" "}
                    {report.counts.cancelled > 0 && "Výběr obsahuje i storna."}
                  </ReportNote>
                </>
              )}
              {activeTab === "receivables" && (
                <>
                  <ReportNote className={styles.scope}>
                    Stav k {displayDate(today)} · pouze faktury odpovídající
                    zvolenému období a filtrům. Historický stav k poslednímu dni
                    období se nerekonstruuje. „Po splatnosti“ vychází z
                    aktuálního stavu faktury.
                  </ReportNote>
                  <div
                    className={styles.metrics}
                    data-expanded={expandedMetrics || undefined}
                    data-report={activeTab}
                    role="group"
                    aria-label="Souhrn reportu"
                    tabIndex={0}
                  >
                    <Metric
                      label="Otevřené pohledávky"
                      value={metricAmount(Number(report.open))}
                      note={`${report.counts.pending + report.counts.overdue} otevřených faktur`}
                    />
                    <Metric
                      label="Po splatnosti"
                      value={metricAmount(Number(report.overdue))}
                      note={`${report.counts.overdue} faktur dle stavu`}
                      danger={Number(report.overdue) > 0}
                    />
                    {[
                      report.aging[1],
                      {
                        label: "8–30 dní",
                        amount:
                          Number(report.aging[2]?.amount ?? 0) +
                          Number(report.aging[3]?.amount ?? 0),
                        count:
                          (report.aging[2]?.count ?? 0) +
                          (report.aging[3]?.count ?? 0),
                      },
                      report.aging[4],
                    ]
                      .filter(Boolean)
                      .map((row) => (
                        <Metric
                          key={row.label}
                          label={row.label}
                          value={metricAmount(Number(row.amount))}
                          note={`${row.count} faktur · podle splatnosti`}
                          danger={
                            row === report.aging[4] && Number(row.amount) > 0
                          }
                        />
                      ))}
                  </div>
                  {metricsToggle}
                  <div className={styles.mainGrid}>
                    <Card
                      className={styles.agingCard}
                      title="Stav pohledávek podle splatnosti"
                      subtitle="Zbývající částky po částečných úhradách"
                    >
                      <div
                        className={styles.agingRows}
                        role="list"
                        aria-label="Pohledávky podle stáří"
                      >
                        {report.aging.map((row, index) => (
                          <div key={row.label} role="listitem">
                            <span
                              className={styles.dot}
                              style={{
                                background: risks[index % risks.length],
                              }}
                            />
                            <span>
                              {index === 0
                                ? "Ve splatnosti (včetně dneška)"
                                : row.label}
                              <small>{row.count} faktur</small>
                            </span>
                            <i>
                              <b
                                style={{
                                  background: risks[index % risks.length],
                                  width: `${Math.min(100, (Math.abs(Number(row.amount)) / Math.max(1, ...report.aging.map((item) => Math.abs(Number(item.amount))))) * 100)}%`,
                                }}
                              />
                            </i>
                            <strong>
                              <ExactMoney
                                value={Number(row.amount)}
                                currency={currency}
                              />
                            </strong>
                          </div>
                        ))}
                      </div>
                    </Card>
                    <Card
                      title="Platební disciplína"
                      subtitle="Za jak dlouho zákazníci faktury skutečně doplácejí"
                    >
                      <dl className={styles.disciplineMetrics}>
                        <div>
                          <dt>Průměr od vystavení do úhrady</dt>
                          <dd>
                            {report.dso.paid_invoice_count
                              ? `${Number(report.dso.avg_days).toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} dní`
                              : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt>Plně uhrazené faktury</dt>
                          <dd>{report.dso.paid_invoice_count}</dd>
                        </div>
                      </dl>
                      {report.dso_monthly.length ? (
                        <>
                          <div className={styles.tableScroll}>
                            <table>
                              <caption>Poslední měsíce úplné úhrady</caption>
                              <thead>
                                <tr>
                                  <th>Měsíc</th>
                                  <th>Průměr dní</th>
                                  <th>Faktur</th>
                                </tr>
                              </thead>
                              <tbody>
                                {report.dso_monthly.slice(-3).map((row) => (
                                  <tr key={row.key}>
                                    <td>{monthLabel(row.key)}</td>
                                    <td>
                                      {Number(row.avg_days).toLocaleString(
                                        "cs-CZ",
                                        { maximumFractionDigits: 1 },
                                      )}
                                    </td>
                                    <td>{row.count}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {report.dso_monthly.length > 3 && (
                            <details className={styles.extra}>
                              <summary>
                                Starší měsíce úhrad
                                <ChevronDown />
                              </summary>
                              <div className={styles.tableScroll}>
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Měsíc</th>
                                      <th>Průměr dní</th>
                                      <th>Faktur</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {report.dso_monthly
                                      .slice(0, -3)
                                      .map((row) => (
                                        <tr key={row.key}>
                                          <td>{monthLabel(row.key)}</td>
                                          <td>
                                            {Number(
                                              row.avg_days,
                                            ).toLocaleString("cs-CZ", {
                                              maximumFractionDigits: 1,
                                            })}
                                          </td>
                                          <td>{row.count}</td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </div>
                            </details>
                          )}
                        </>
                      ) : (
                        <Empty>
                          Ve výběru zatím nejsou plně uhrazené faktury s datem
                          úhrady.
                        </Empty>
                      )}
                      {!mobile && (
                        <p className={styles.help}>
                          Pouze plně uhrazené faktury z aktuálního výběru.
                          Částečné úhrady se do průměru nezahrnují.
                        </p>
                      )}
                    </Card>
                  </div>
                  <Card
                    title="Největší otevřené pohledávky"
                    subtitle="Výběr odběratele filtruje celý report"
                  >
                    <div
                      className={`${styles.tableScroll} ${styles.debtorsTable}`}
                    >
                      <table>
                        <thead>
                          <tr>
                            <th>Odběratel</th>
                            <th>Otevřeno</th>
                            <th>Po splatnosti</th>
                            <th>Faktur</th>
                            <th>Upomínky</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allDebtors
                            .slice(0, showDebtors ? 10 : 5)
                            .map((row) => (
                              <tr key={row.name}>
                                <td>
                                  <button
                                    className={styles.textButton}
                                    onClick={() => setCustomer(row.name)}
                                  >
                                    {row.name}
                                  </button>
                                </td>
                                <td data-label="Otevřeno">
                                  <ExactMoney
                                    value={Number(row.open)}
                                    currency={currency}
                                  />
                                </td>
                                <td
                                  data-label="Po splatnosti"
                                  className={
                                    Number(row.overdue) > 0
                                      ? styles.danger
                                      : undefined
                                  }
                                >
                                  <ExactMoney
                                    value={Number(row.overdue)}
                                    currency={currency}
                                  />
                                </td>
                                <td data-label="Faktur">{row.count}</td>
                                <td data-label="Upomínky">{row.reminders}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    {!allDebtors.length && (
                      <Empty>Ve výběru nejsou žádné otevřené pohledávky.</Empty>
                    )}
                    {allDebtors.length > 5 && (
                      <button
                        className={styles.textButton}
                        onClick={() => setShowDebtors(!showDebtors)}
                      >
                        {showDebtors
                          ? "Zobrazit prvních 5"
                          : "Zobrazit prvních 10"}
                      </button>
                    )}
                    <Link className={styles.textButton} href="/customers">
                      Registr zákazníků a jejich faktury →
                    </Link>
                  </Card>
                </>
              )}
              {activeTab === "payments" &&
                (() => {
                  const summary = report.payment_reconciliation,
                    totals = summary.totals;
                  return (
                    <>
                      <div
                        className={styles.metrics}
                        data-expanded={expandedMetrics || undefined}
                        data-report={activeTab}
                        role="group"
                        aria-label="Souhrn reportu"
                        tabIndex={0}
                      >
                        <Metric
                          label="Přijaté řádky výpisů"
                          value={totals.accepted}
                          note={`${totals.imports} zaúčtovaných výpisů`}
                        />
                        <Metric
                          label="Posouzené jako bezpečné"
                          value={totals.auto_matched}
                          note="Přijaté řádky s bezpečným návrhem"
                        />
                        <Metric
                          label="Ruční posouzení"
                          value={totals.needs_review}
                          note="Po posouzení nebo bez návrhu"
                        />
                        <Metric
                          label="Nespárované platby"
                          value={totals.unmatched_payments}
                          note="Jiná populace · datum bankovní platby"
                          danger={totals.unmatched_payments > 0}
                        />
                      </div>
                      {metricsToggle}
                      {totals.unacknowledged_mismatch_imports > 0 && (
                        <p role="alert" className={styles.warning}>
                          Nepotvrzený nesoulad bankovního účtu u{" "}
                          {totals.unacknowledged_mismatch_imports} zaúčtovaných
                          výpisů.
                        </p>
                      )}
                      <div className={styles.mainGrid}>
                        <Card
                          title="Zaúčtované řádky výpisů"
                          subtitle="Počty podle měsíce zaúčtování výpisu, nikoli částky plateb"
                        >
                          {summary.monthly.length ? (
                            <Columns
                              rows={summary.monthly.map((row) => ({
                                key: row.key,
                                a: row.auto_matched,
                                b: row.needs_review,
                              }))}
                              first="Bezpečný návrh"
                              second="Ruční posouzení"
                              colors={["#08794c", "#e5bb32"]}
                              format={(value) => `${value} řádků`}
                            />
                          ) : (
                            <Empty>
                              V období nejsou žádné zaúčtované výpisy.
                            </Empty>
                          )}
                        </Card>
                        <Card
                          title="Způsob posouzení"
                          subtitle="Pouze přijaté řádky ze zaúčtovaných výpisů"
                        >
                          <Distribution
                            rows={[
                              {
                                label: "Bezpečný návrh",
                                value: totals.auto_matched,
                                color: greens[0],
                                detail: `${totals.auto_matched} řádků`,
                              },
                              {
                                label: "Ruční posouzení",
                                value: totals.needs_review,
                                color: "#e5bb32",
                                detail: `${totals.needs_review} řádků`,
                              },
                            ]}
                            totalLabel={`${totals.auto_matched + totals.needs_review}`}
                            description="posouzených řádků"
                          />
                          {!mobile && (
                            <p className={styles.help}>
                              Nespárované platby nejsou součástí tohoto podílu.
                              Bezpečný návrh neurčuje, zda bylo zaúčtování
                              spuštěno automaticky.
                            </p>
                          )}
                        </Card>
                      </div>
                    </>
                  );
                })()}
            </section>
          </>
        )}
      </div>
      <Modal
        open={showCustomers}
        onClose={() => setShowCustomers(false)}
        labelledBy="report-customers-title"
        className={styles.customerDialog}
      >
        <header>
          <div>
            <h2 id="report-customers-title">Přehled odběratelů</h2>
            <p>Výběrem odběratele vyfiltrujete report.</p>
          </div>
          <button
            type="button"
            aria-label="Zavřít přehled odběratelů"
            onClick={() => setShowCustomers(false)}
          >
            <CloseIcon width="18" height="18" />
          </button>
        </header>
        <label className={styles.customerSearch}>
          <Icon name="search" />
          <input
            type="search"
            ref={(input) => input?.setAttribute("autofocus", "")}
            aria-label="Hledat odběratele"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setShowCustomers(false);
              }
            }}
            placeholder="Hledat podle názvu…"
            value={customerSearch}
            onChange={(event) => setCustomerSearch(event.target.value)}
          />
        </label>
        <p className={styles.customerResults} role="status">
          Nalezeno: {visibleCustomers.length} · částky ve výběru ({currency})
          {visibleCustomers.length > 100 &&
            " · Zobrazeno prvních 100, zpřesněte hledání."}
        </p>
        <div
          className={styles.customerList}
          role="region"
          aria-label="Seznam odběratelů"
          tabIndex={0}
        >
          {visibleCustomers.slice(0, 100).map((name) => {
            const row = customerTotals.get(name);
            return (
              <button
                type="button"
                key={name}
                aria-pressed={customer === name}
                onClick={() => {
                  setShowCustomers(false);
                  setCustomer(name);
                }}
              >
                <span>
                  <strong>{name}</strong>
                  <small>
                    {row
                      ? `Počet faktur: ${row.count}`
                      : "Vyberte pro zobrazení souhrnu"}
                  </small>
                </span>
                <span className={styles.customerAmount}>
                  {row ? (
                    <ExactMoney
                      value={Number(row.revenue)}
                      currency={currency}
                    />
                  ) : (
                    "→"
                  )}
                </span>
              </button>
            );
          })}
          {!visibleCustomers.length && (
            <Empty>Žádný odběratel neodpovídá hledání.</Empty>
          )}
        </div>
        <div className={styles.customerDialogFooter}>
          <Link href="/customers">Otevřít registr zákazníků →</Link>
        </div>
      </Modal>
    </AppFrame>
  );
}
