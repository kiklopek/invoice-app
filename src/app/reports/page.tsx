"use client";

import { useEffect, useState } from "react";
import { AppFrame } from "@/components/app-sidebar";
import { Icon } from "@/components/icons";
import { todayInTimeZone } from "@/lib/reminders";
import type { InvoiceReport, ReportDateBasis } from "@/lib/report-query";
import type { InvoiceStatus } from "@/types/invoice";

const iso = (date: Date) => date.toISOString().slice(0, 10);
const money = (value: number, currency: string) =>
  new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
const statusNames: Record<InvoiceStatus, string> = {
  pending: "Čeká",
  overdue: "Po splatnosti",
  paid: "Zaplaceno",
  cancelled: "Storno",
};
export default function ReportsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [currency, setCurrency] = useState("CZK");
  const [status, setStatus] = useState<"all" | InvoiceStatus>("all");
  const [customer, setCustomer] = useState("all");
  const [dateBasis, setDateBasis] = useState<ReportDateBasis>("issue_date");
  const [report, setReport] = useState<InvoiceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  function requestParams(format?: "csv") {
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

  useEffect(() => {
    const today = todayInTimeZone();
    setFrom(`${today.slice(0, 4)}-01-01`);
    setTo(today);
  }, []);
  useEffect(() => {
    if (!from || !to) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/reports?${requestParams().toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        return data;
      })
      .then((data) => setReport(data))
      .catch((cause) => {
        if (cause instanceof Error && cause.name !== "AbortError")
          setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, dateBasis, currency, status, customer]);

  function preset(type: "month" | "quarter" | "year") {
    const today = todayInTimeZone();
    const end = new Date(`${today}T12:00:00.000Z`);
    const start = new Date(end);
    if (type === "month") start.setUTCDate(1);
    else if (type === "quarter")
      start.setUTCMonth(Math.floor(end.getUTCMonth() / 3) * 3, 1);
    else start.setUTCMonth(0, 1);
    setFrom(iso(start));
    setTo(today);
  }
  async function exportCsv() {
    setExporting(true);
    setError("");
    try {
      const response = await fetch(
        `/api/reports?${requestParams("csv").toString()}`,
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Export se nepodařilo připravit.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `report-${from}-${to}-${currency}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Export se nepodařilo připravit.",
      );
    } finally {
      setExporting(false);
    }
  }

  const currencies = report?.currencies ?? [];
  const customers = report?.customers ?? [];
  const maxAge = Math.max(
    1,
    ...(report?.aging.map((bucket) => Number(bucket.amount)) ?? []),
  );

  return (
    <AppFrame>
      <header className="section-header">
        <div>
          <p>ANALYTIKA</p>
          <h1>Reporty</h1>
          <span>
            Finanční přehled pohledávek a platební disciplíny za vybrané období.
          </span>
        </div>
        <div className="section-actions">
          <button className="btn secondary" onClick={() => window.print()}>
            <Icon name="print" />
            Vytisknout
          </button>
          <button
            className="btn primary"
            disabled={!report?.invoice_count || exporting}
            onClick={exportCsv}
          >
            <Icon name="download" />
            {exporting ? "Připravuji…" : "Exportovat CSV"}
          </button>
        </div>
      </header>
      <section className="page-panel report-filters">
        <div className="period-presets">
          <button onClick={() => preset("month")}>Tento měsíc</button>
          <button onClick={() => preset("quarter")}>Toto čtvrtletí</button>
          <button onClick={() => preset("year")}>Tento rok</button>
        </div>
        <label>
          <span>Období podle</span>
          <select
            value={dateBasis}
            onChange={(e) => setDateBasis(e.target.value as ReportDateBasis)}
          >
            <option value="issue_date">data vystavení</option>
            <option value="due_date">data splatnosti</option>
            <option value="paid_at">data úhrady</option>
          </select>
        </label>
        <label>
          <span>Od</span>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          <span>Do</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          <span>Měna</span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {currencies.length ? (
              currencies.map((item) => <option key={item}>{item}</option>)
            ) : (
              <option>CZK</option>
            )}
          </select>
        </label>
        <label>
          <span>Stav</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="all">Všechny</option>
            {Object.entries(statusNames).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="customer-filter">
          <span>Odběratel</span>
          <select
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          >
            <option value="all">Všichni odběratelé</option>
            {customers.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      </section>
      {error ? (
        <p className="page-state error-state">{error}</p>
      ) : loading || !report ? (
        <p className="page-state">Připravuji report…</p>
      ) : (
        <>
          <section className="report-metrics">
            <article>
              <span>Vystaveno</span>
              <strong>{money(Number(report.total), currency)}</strong>
              <small>{report.invoice_count} faktur ve výběru</small>
            </article>
            <article>
              <span>Otevřené pohledávky</span>
              <strong>{money(Number(report.open), currency)}</strong>
              <small>čeká na zaplacení</small>
            </article>
            <article>
              <span>Po splatnosti</span>
              <strong className="red-text">
                {money(Number(report.overdue), currency)}
              </strong>
              <small>{report.counts.overdue} faktur po termínu</small>
            </article>
            <article>
              <span>Přijaté úhrady</span>
              <strong>{money(Number(report.paid), currency)}</strong>
              <small>{report.paid_rate} % z hodnoty faktur · včetně částečných</small>
            </article>
          </section>
          <div className="analytics-grid">
            <section className="page-panel analytics-card">
              <header>
                <div>
                  <h2>Stav faktur</h2>
                  <p>Počet podle aktuálního stavu</p>
                </div>
              </header>
              <div className="donut-wrap">
                <div
                  className="donut"
                  style={{
                    background: report.invoice_count
                      ? `conic-gradient(#2f7650 0 ${(report.counts.paid / report.invoice_count) * 100}%, #c45143 0 ${((report.counts.paid + report.counts.overdue) / report.invoice_count) * 100}%, #d69a3b 0 ${((report.counts.paid + report.counts.overdue + report.counts.pending) / report.invoice_count) * 100}%, #aab1ac 0)`
                      : "#edf0ed",
                  }}
                >
                  <span>
                    <strong>{report.invoice_count}</strong>faktur
                  </span>
                </div>
                <div className="donut-legend">
                  {(Object.keys(statusNames) as InvoiceStatus[]).map((key) => (
                    <div key={key}>
                      <i className={key} />
                      <span>{statusNames[key]}</span>
                      <strong>{report.counts[key]}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </section>
            <section className="page-panel analytics-card">
              <header>
                <div>
                  <h2>Stáří pohledávek</h2>
                  <p>Otevřené částky podle prodlení</p>
                </div>
              </header>
              <div className="aging-report">
                {report.aging.map((bucket) => (
                  <div key={bucket.label}>
                    <div>
                      <strong>{bucket.label}</strong>
                      <span>
                        {bucket.count} ·{" "}
                        {money(Number(bucket.amount), currency)}
                      </span>
                    </div>
                    <i>
                      <b
                        style={{
                          width: `${(Number(bucket.amount) / maxAge) * 100}%`,
                        }}
                      />
                    </i>
                  </div>
                ))}
              </div>
            </section>
            <section className="page-panel analytics-card full">
              <header>
                <div>
                  <h2>Odběratelé s otevřenými pohledávkami</h2>
                  <p>Seřazeno podle celkové neuhrazené částky</p>
                </div>
              </header>
              <div className="debtor-table">
                <table>
                  <thead>
                    <tr>
                      <th>Odběratel</th>
                      <th>Otevřené faktury</th>
                      <th>Celkem otevřeno</th>
                      <th>Z toho po splatnosti</th>
                      <th>Odeslané upomínky</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.debtors.map((row) => (
                      <tr key={row.name}>
                        <td>
                          <strong>{row.name}</strong>
                        </td>
                        <td>{row.count}</td>
                        <td>{money(Number(row.open), currency)}</td>
                        <td className={Number(row.overdue) ? "red-text" : ""}>
                          {money(Number(row.overdue), currency)}
                        </td>
                        <td>{row.reminders}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!report.debtors.length && (
                  <p className="empty-box">
                    Ve výběru nejsou otevřené pohledávky.
                  </p>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </AppFrame>
  );
}
