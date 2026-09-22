"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import useSWR from "swr";
import { AppFrame } from "@/components/layout/app-shell";
import { CompanyLogo } from "@/components/company-logo";
import { Icon } from "@/components/icons";
import { MobileDisclosure } from "@/components/mobile-disclosure";
import { todayInTimeZone } from "@/lib/reminders";
import type { ReportDateBasis } from "@/lib/report-query";
import type { ReportPageData } from "@/lib/report-page-data";
import { useAccessProfile } from "@/lib/use-access-role";
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
const statusChartOrder: InvoiceStatus[] = ["paid", "overdue", "pending", "cancelled"];
type ReportTab = "revenue" | "vat" | "receivables" | "payments";
const reportTabs: Array<{ id: ReportTab; label: string; icon: "chart" | "invoice" | "clock" | "bank" }> = [
  { id: "revenue", label: "Tržby", icon: "chart" },
  { id: "vat", label: "DPH", icon: "invoice" },
  { id: "receivables", label: "Pohledávky", icon: "clock" },
  { id: "payments", label: "Platby", icon: "bank" },
];
const dateBasisNames: Record<ReportDateBasis, string> = {
  issue_date: "Datum vystavení",
  due_date: "Datum splatnosti",
  paid_at: "Datum úhrady",
};
const displayDate = (value: string) =>
  value
    ? new Intl.DateTimeFormat("cs-CZ").format(new Date(`${value}T12:00:00`))
    : "-";
const displayDateTime = (value: Date) =>
  new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

export function ReportsClient({ initialData, initialFrom, initialTo, initialGeneratedAt }: { initialData: ReportPageData; initialFrom: string; initialTo: string; initialGeneratedAt: string }) {
  const profile = useAccessProfile();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [currency, setCurrency] = useState("CZK");
  const [status, setStatus] = useState<"all" | InvoiceStatus>("all");
  const [customer, setCustomer] = useState("all");
  const [dateBasis, setDateBasis] = useState<ReportDateBasis>("issue_date");
  const [report, setReport] = useState<ReportPageData | null>(initialData);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [generatedAt, setGeneratedAt] = useState(() => new Date(initialGeneratedAt));
  const [activeTab, setActiveTab] = useState<ReportTab>("revenue");

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

  const reportKey = `/api/reports?${requestParams().toString()}`;
  const initialKey = `/api/reports?${new URLSearchParams({ from: initialFrom, to: initialTo, date_basis: "issue_date", currency: "CZK" }).toString()}`;
  const { data: refreshedReport, error: loadError, isLoading } = useSWR<ReportPageData>(reportKey, {
    fallbackData: reportKey === initialKey ? initialData : undefined,
    revalidateOnMount: reportKey !== initialKey,
  });
  const loading = isLoading && !refreshedReport;
  useEffect(() => { if (loadError instanceof Error) setError(loadError.message); }, [loadError]);
  useEffect(() => { if (refreshedReport) { setReport(refreshedReport); setGeneratedAt(new Date()); } }, [refreshedReport]);

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

  function moveReportTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const lastIndex = reportTabs.length - 1;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? lastIndex
        : event.key === "ArrowRight"
          ? (index + 1) % reportTabs.length
          : (index - 1 + reportTabs.length) % reportTabs.length;
    const nextTab = reportTabs[nextIndex];
    setActiveTab(nextTab.id);
    document.getElementById(`report-tab-${nextTab.id}`)?.focus();
  }

  async function exportExcel() {
    setExporting(true);
    setError("");
    try {
      const response = await fetch(
        `/api/reports?${requestParams("xlsx").toString()}`,
      );
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
      setExporting(false);
    }
  }

  const currencies = report?.currencies ?? [];
  const customers = report?.customers ?? [];
  const maxMonthly = Math.max(
    1,
    ...(report?.monthly.flatMap((month) => [Number(month.issued), Number(month.paid)]) ?? []),
  );
  const maxDsoMonthly = Math.max(1, ...(report?.dso_monthly.map((month) => Number(month.avg_days)) ?? []));
  const maxYoyMonthly = Math.max(1, ...(report?.yoy_monthly.flatMap((month) => [Number(month.current_year), Number(month.prior_year)]) ?? []));
  const maxConcentration = Math.max(1, ...(report?.customer_concentration.map((row) => Number(row.revenue)) ?? []));
  const maxAging = Math.max(1, ...(report?.aging.map((bucket) => Number(bucket.amount)) ?? []));
  const maxVatGross = Math.max(1, ...(report?.vat_breakdown.map((row) => Number(row.gross)) ?? []));
  const concentrationTotal = report?.customer_concentration.reduce((sum, row) => sum + Number(row.revenue), 0) || 1;
  const netTotal = report?.vat_breakdown.reduce((sum, row) => sum + Number(row.base), 0) ?? 0;
  const taxTotal = report?.vat_breakdown.reduce((sum, row) => sum + Number(row.tax), 0) ?? 0;
  const monthNumberLabel = (monthNumber: string) => new Intl.DateTimeFormat("cs-CZ", { month: "short" }).format(new Date(2024, Number(monthNumber) - 1, 1));
  const priorYearNumber = to ? Number(to.slice(0, 4)) - 1 : new Date().getFullYear() - 1;
  const currentYearNumber = to ? Number(to.slice(0, 4)) : new Date().getFullYear();
  const monthAxisLabel = (key: string) => {
    const [year, month] = key.split("-").map(Number);
    return new Intl.DateTimeFormat("cs-CZ", { month: "short" }).format(new Date(year, (month || 1) - 1, 1)) + " " + String(year).slice(2);
  };
  // Neutrální záloha: konkrétní firma v kódu by se objevila u jiného
  // zákazníka na tištěném reportu.
  const companyName = profile?.companyName?.trim() || "Účetní oddělení";
  const selectedStatus = status === "all" ? "Všechny stavy" : statusNames[status];
  const selectedCustomer = customer === "all" ? "Všichni odběratelé" : customer;
  const printPeriod = `${displayDate(from)} - ${displayDate(to)}`;

  return (
    <AppFrame>
      <header className="section-header report-screen-header">
        <div>
          <p>ANALYTIKA</p>
          <h1>Reporty</h1>
          <span>
            Finanční přehled pohledávek a platební disciplíny za vybrané období.
          </span>
        </div>
        <div className="section-actions">
          <button className="btn secondary" disabled={loading || !report} onClick={() => window.print()}>
            <Icon name="print" />
            Vytisknout
          </button>
          <button
            className="btn primary"
            disabled={!report?.invoice_count || exporting}
            onClick={exportExcel}
          >
            <Icon name="download" />
            {exporting ? "Připravuji…" : "Exportovat do Excelu"}
          </button>
        </div>
      </header>
      <MobileDisclosure label="Období a filtry reportu" className="mobile-filter-disclosure">
      <section className="page-panel report-filters">
        <div className="period-presets" role="group" aria-label="Rychlá volba období">
          <button type="button" onClick={() => preset("month")}>Tento měsíc</button>
          <button type="button" onClick={() => preset("quarter")}>Toto čtvrtletí</button>
          <button type="button" onClick={() => preset("year")}>Tento rok</button>
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
      </MobileDisclosure>
      {error ? (
        <p className="page-state error-state">{error}</p>
      ) : loading || !report ? (
        <p className="page-state">Připravuji report…</p>
      ) : (
        <>
          <section className="report-print-cover" aria-hidden="true">
            <CompanyLogo className="report-print-logo" />
            <div className="report-print-title">
              <span>FINANČNÍ REPORT</span>
              <h1>Účetní report</h1>
              <p>{companyName}</p>
            </div>
            <dl className="report-print-meta">
              <div><dt>Období</dt><dd>{printPeriod}</dd></div>
              <div><dt>Období podle</dt><dd>{dateBasisNames[dateBasis]}</dd></div>
              <div><dt>Měna</dt><dd>{currency}</dd></div>
              <div><dt>Stav</dt><dd>{selectedStatus}</dd></div>
              <div className="wide"><dt>Odběratel</dt><dd>{selectedCustomer}</dd></div>
              <div><dt>Vytvořeno</dt><dd>{displayDateTime(generatedAt)}</dd></div>
            </dl>
          </section>
          <section className="report-accounting-summary" aria-label="Účetní souhrn">
            {[
              ["Základ bez DPH", money(netTotal, currency), `${report.invoice_count} faktur`],
              ["DPH", money(taxTotal, currency), "daň ve výběru"],
              ["Fakturováno celkem", money(Number(report.total), currency), printPeriod],
              ["Přijaté úhrady", money(Number(report.paid), currency), `${report.paid_rate} % uhrazeno`],
              ["Otevřené pohledávky", money(Number(report.open), currency), `${money(Number(report.overdue), currency)} po splatnosti`],
            ].map(([label, value, note], index) => (
              <article className={index === 2 ? "primary" : index === 4 ? "warning" : ""} key={label}>
                <span>{label}</span><strong>{value}</strong><small>{note}</small>
              </article>
            ))}
          </section>

          <nav className="report-tabs" role="tablist" aria-label="Části účetního reportu">
            {reportTabs.map((tab, index) => (
              <button
                id={`report-tab-${tab.id}`}
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`report-panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => moveReportTab(event, index)}
              ><Icon name={tab.icon}/><span>{tab.label}</span></button>
            ))}
          </nav>

          <div className="report-tab-panels">
            <section id="report-panel-revenue" role="tabpanel" aria-labelledby="report-tab-revenue" aria-hidden={activeTab !== "revenue"} className={`report-tab-panel${activeTab === "revenue" ? " active" : ""}`}>
              <div className="report-tab-intro"><div><span>01</span><h2>Tržby</h2></div><p>Vývoj fakturace, úhrad a struktury odběratelů.</p></div>
              <div className="report-revenue-layout">
                <div className="report-revenue-main">
                <article className="page-panel report-card report-revenue-card report-revenue-primary-card">
                  <header><div><h3>Fakturace a úhrady</h3><p>Měsíční srovnání vystavených a přijatých částek</p></div><div className="report-chart-key"><span className="issued">Vystaveno</span><span className="paid">Uhrazeno</span></div></header>
                  <div className={`report-column-chart report-revenue-chart${report.monthly.length === 1 ? " is-single" : ""}`} role="group" aria-label="Měsíční fakturace a úhrady, částky jsou uvedeny nad sloupci">
                    {report.monthly.map((month) => <div className="report-column-group" key={month.key}>
                      <div className="report-column-values"><small className="issued">{money(Number(month.issued), currency)}</small><small className="paid">{money(Number(month.paid), currency)}</small></div>
                      <div className="report-columns"><i className="issued" style={{ height: `${(Number(month.issued) / maxMonthly) * 100}%` }}/><i className="paid" style={{ height: `${(Number(month.paid) / maxMonthly) * 100}%` }}/></div>
                      <span>{monthAxisLabel(month.key)}</span>
                    </div>)}
                    {!report.monthly.length && <p className="report-revenue-empty">Ve vybraném období nejsou žádné faktury.</p>}
                  </div>
                </article>
                <article className="page-panel report-card report-revenue-card report-revenue-yoy-card">
                  <header><div><h3>Meziroční srovnání</h3><p>{currentYearNumber} oproti {priorYearNumber}</p></div><div className="report-chart-key"><span className="prior">{priorYearNumber}</span><span className="current">{currentYearNumber}</span></div></header>
                  <div className={`report-column-chart compact report-revenue-chart${report.yoy_monthly.length === 1 ? " is-single" : ""}`} role="group" aria-label="Meziroční srovnání podle měsíce, částky jsou uvedeny nad sloupci">
                    {report.yoy_monthly.map((month) => <div className="report-column-group" key={month.month}>
                      <div className="report-column-values"><small className="prior">{money(Number(month.prior_year), currency)}</small><small className="current">{money(Number(month.current_year), currency)}</small></div>
                      <div className="report-columns"><i className="prior" style={{ height: `${Number(month.prior_year) / maxYoyMonthly * 100}%` }}/><i className="current" style={{ height: `${Number(month.current_year) / maxYoyMonthly * 100}%` }}/></div>
                      <span>{monthNumberLabel(month.month)}</span>
                    </div>)}
                    {!report.yoy_monthly.length && <p className="report-revenue-empty">Pro srovnání nejsou dostupná data.</p>}
                  </div>
                </article>
                </div>
                <div className="report-revenue-aside">
                <article className="page-panel report-card report-revenue-card report-revenue-customers-card">
                  <header><div><h3>Největší odběratelé</h3><p>Podíl na tržbách v období</p></div></header>
                  <div className="report-ranking">
                    {report.customer_concentration.map((row) => <div key={row.name}><div><span>{row.name}</span><strong>{Math.round(Number(row.revenue) / concentrationTotal * 100)} %</strong></div><i><b style={{ width: `${Number(row.revenue) / maxConcentration * 100}%` }}/></i><small>{money(Number(row.revenue), currency)}</small></div>)}
                    {!report.customer_concentration.length && <p className="report-revenue-empty">Zatím nejsou tržby podle odběratelů.</p>}
                  </div>
                </article>
                <article className="page-panel report-card report-revenue-card report-revenue-average-card">
                  <header><div><h3>Průměrná faktura</h3></div><span className="report-average-icon" aria-hidden="true"><Icon name="chart" /></span></header>
                  <div className="report-revenue-average-hero"><strong>{money(report.invoice_count ? Number(report.total) / report.invoice_count : 0, currency)}</strong></div>
                </article>
                </div>
              </div>
            </section>

            <section id="report-panel-vat" role="tabpanel" aria-labelledby="report-tab-vat" aria-hidden={activeTab !== "vat"} className={`report-tab-panel${activeTab === "vat" ? " active" : ""}`}>
              <div className="report-tab-intro"><div><span>02</span><h2>DPH</h2></div><p>Daňové základy, vypočtená daň a celkové částky podle sazeb.</p></div>
              <div className="report-workspace-grid report-vat-grid">
                <article className="page-panel report-card report-span-8"><header><div><h3>Rozpis podle sazby DPH</h3><p>Podklad pro kontrolu daňového přiznání</p></div></header><div className="report-accounting-table"><table className="vat-breakdown-table"><thead><tr><th>Sazba</th><th>Základ daně</th><th>DPH</th><th>Celkem</th><th>Faktur</th></tr></thead><tbody>{report.vat_breakdown.map((row) => <tr key={row.vat_rate}><td data-label="Sazba"><strong>{row.vat_rate} %</strong></td><td data-label="Základ daně">{money(Number(row.base), currency)}</td><td data-label="DPH">{money(Number(row.tax), currency)}</td><td data-label="Celkem">{money(Number(row.gross), currency)}</td><td data-label="Faktur">{row.count}</td></tr>)}</tbody><tfoot><tr><td data-label="Sazba"><strong>Celkem</strong></td><td data-label="Základ daně"><strong>{money(netTotal, currency)}</strong></td><td data-label="DPH"><strong>{money(taxTotal, currency)}</strong></td><td data-label="Celkem"><strong>{money(Number(report.total), currency)}</strong></td><td data-label="Faktur"><strong>{report.vat_breakdown.reduce((sum, row) => sum + row.count, 0)}</strong></td></tr></tfoot></table></div></article>
                <article className="page-panel report-card report-span-4 report-vat-structure-card"><header><div><h3>Struktura DPH</h3><p>Poměr jednotlivých sazeb</p></div></header><div className="report-vat-bars">{report.vat_breakdown.map((row) => <div key={row.vat_rate}><div><span>{row.vat_rate} %</span><strong>{money(Number(row.gross), currency)}</strong></div><i><b style={{ width: `${Number(row.gross) / maxVatGross * 100}%` }}/></i><small>Základ {money(Number(row.base), currency)} · DPH {money(Number(row.tax), currency)}</small></div>)}</div></article>
              </div>
            </section>

            <section id="report-panel-receivables" role="tabpanel" aria-labelledby="report-tab-receivables" aria-hidden={activeTab !== "receivables"} className={`report-tab-panel${activeTab === "receivables" ? " active" : ""}`}>
              <div className="report-tab-intro"><div><span>03</span><h2>Pohledávky</h2></div><p>Stav faktur, stáří dluhu a platební disciplína odběratelů.</p></div>
              <article className="page-panel report-card report-status-card"><header><div><h3>Stav faktur</h3><p>{report.invoice_count} faktur ve vybraném období</p></div><strong>{money(Number(report.open), currency)} otevřeno</strong></header><div className="report-segmented-bar">{statusChartOrder.map((key) => <i key={key} className={key} style={{ width: `${report.invoice_count ? report.counts[key] / report.invoice_count * 100 : 0}%` }}/>)}</div><div className="report-segment-legend">{statusChartOrder.map((key) => <div key={key}><i className={key}/><span>{statusNames[key]}</span><strong>{report.counts[key]}</strong></div>)}</div></article>
              <div className="report-workspace-grid">
                <article className="page-panel report-card report-span-5"><header><div><h3>Stáří pohledávek</h3><p>Částky podle dní po splatnosti</p></div></header><div className="report-aging-chart">{report.aging.map((bucket, index) => <div className={`report-aging-row risk-${index}`} key={bucket.label}><div><span>{bucket.label}</span><strong>{money(Number(bucket.amount), currency)}</strong></div><i><b style={{ width: `${Number(bucket.amount) / maxAging * 100}%` }}/></i><small>{bucket.count} {bucket.count === 1 ? "faktura" : "faktur"}</small></div>)}</div></article>
                <article className="page-panel report-card report-span-7 report-dso-card"><header><div><h3>Doba do úplné úhrady</h3><p>Průměr podle měsíce platby · celkem {report.dso.avg_days} dní</p></div></header><div className={`report-column-chart compact single-series report-dso-chart${report.dso_monthly.length === 1 ? " is-single" : ""}`}>{report.dso_monthly.map((month) => <div className="report-column-group" key={month.key}><div className="report-column-values"><small>{month.avg_days} dní</small></div><div className="report-columns"><i className="paid" style={{ height: `${(Number(month.avg_days) / maxDsoMonthly) * 100}%` }}/></div><span>{monthAxisLabel(month.key)}</span></div>)}</div></article>
                <article className="page-panel report-card report-span-12"><header><div><h3>Přehled dlužníků</h3><p>Kliknutím na řádek omezíte celý report na vybraného odběratele</p></div></header><div className="report-accounting-table"><table className="top-debtors-table"><thead><tr><th>Odběratel</th><th>Otevřeno</th><th>Po splatnosti</th><th>Faktur</th><th>Upomínky</th></tr></thead><tbody>{report.debtors.map((row) => <tr key={row.name} role="button" tabIndex={0} onClick={() => setCustomer(row.name)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setCustomer(row.name); } }}><td data-label="Odběratel"><strong>{row.name}</strong></td><td data-label="Otevřeno">{money(Number(row.open), currency)}</td><td data-label="Po splatnosti" className={row.overdue ? "red-text" : undefined}>{money(Number(row.overdue), currency)}</td><td data-label="Faktur">{row.count}</td><td data-label="Upomínky">{row.reminders}</td></tr>)}</tbody></table></div></article>
              </div>
            </section>

            <section id="report-panel-payments" role="tabpanel" aria-labelledby="report-tab-payments" aria-hidden={activeTab !== "payments"} className={`report-tab-panel${activeTab === "payments" ? " active" : ""}`}>
              <div className="report-tab-intro"><div><span>04</span><h2>Platby</h2></div><p>Výsledek automatického párování bankovních transakcí.</p></div>
              {(() => { const totals = report.payment_reconciliation.totals; const reviewed = totals.auto_matched + totals.needs_review; return <>
                <section className="report-payment-metrics"><article><span>Přijaté platby</span><strong>{totals.accepted}</strong><small>potvrzeno v období</small></article><article><span>Automaticky spárováno</span><strong>{totals.auto_matched}</strong><small>{reviewed ? Math.round(totals.auto_matched / reviewed * 100) : 0} % posouzených</small></article><article><span>Ruční kontrola</span><strong>{totals.needs_review}</strong><small>vyžadovalo rozhodnutí</small></article><article><span>Nespárované</span><strong>{totals.unmatched_payments}</strong><small>zbývá vyřešit</small></article>{totals.unacknowledged_mismatch_imports > 0 && <article className="report-payment-alert"><span>Nepotvrzený nesoulad účtu</span><strong>{totals.unacknowledged_mismatch_imports}</strong><small>výpis(y) zaúčtovány automaticky bez potvrzení</small></article>}</section>
                <article className="page-panel report-card report-payment-result"><header><div><h3>Úspěšnost párování</h3><p>Poměr automatického zpracování a ruční kontroly</p></div></header><div className="report-payment-bar"><i className="auto" style={{ width: `${reviewed ? totals.auto_matched / reviewed * 100 : 0}%` }}/><i className="review" style={{ width: `${reviewed ? totals.needs_review / reviewed * 100 : 0}%` }}/></div><div className="report-payment-legend"><span><i className="auto"/>Automaticky <strong>{totals.auto_matched}</strong></span><span><i className="review"/>Ruční kontrola <strong>{totals.needs_review}</strong></span></div></article>
              </>; })()}
              <article className="page-panel report-card report-imports-card"><header><div><h3>Poslední potvrzené výpisy</h3><p>Importy bankovních plateb ve vybraném období</p></div></header>{report.payment_reconciliation.recent_imports.length ? <div className="report-import-list">{report.payment_reconciliation.recent_imports.map((item) => <div key={item.id}><span>{item.filename}</span><time>{new Intl.DateTimeFormat("cs-CZ").format(new Date(item.committed_at))}</time><strong>{item.auto_matched} automaticky · {item.needs_review} kontrola{item.error_count ? ` · ${item.error_count} chyb` : ""}</strong></div>)}</div> : <p className="empty-report">V období nejsou žádné potvrzené bankovní výpisy.</p>}</article>
            </section>
          </div>

          <footer className="report-print-footer" aria-hidden="true">
            <span>{companyName} · Účetní report · {printPeriod}</span>
            <span>Vytvořeno {displayDateTime(generatedAt)}</span>
          </footer>
        </>
      )}
    </AppFrame>
  );
}
