"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppFrame } from "@/components/app-sidebar";
import { Icon } from "@/components/icons";
import type { Invoice } from "@/types/invoice";

const money = (value: number, currency: string) => new Intl.NumberFormat("cs-CZ", {
  style: "currency", currency, maximumFractionDigits: 0,
}).format(value);
const date = (value: string | null) => value
  ? new Intl.DateTimeFormat("cs-CZ").format(new Date(value))
  : "—";

export default function InvoiceArchivePage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [archiveStatus, setArchiveStatus] = useState<"closed" | "paid" | "cancelled">("closed");
  const [currency, setCurrency] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [activeCount, setActiveCount] = useState(0);

  function requestParams(requestedPage = page, format?: "csv") {
    const params = new URLSearchParams({ paged: "1", page: String(requestedPage), status: archiveStatus });
    if (query.trim()) params.set("q", query.trim());
    if (currency !== "all") params.set("currency", currency);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (format) params.set("format", format);
    return params;
  }

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      fetch(`/api/invoices?${requestParams().toString()}`, { signal: controller.signal })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error);
          return data;
        })
        .then((data) => {
          setInvoices(data.invoices ?? []);
          setTotal(Number(data.total) || 0);
          setTotalPages(Number(data.total_pages) || 1);
          setCurrencies(data.currencies ?? []);
          setActiveCount(Number(data.active_count) || 0);
        })
        .catch((cause) => {
          if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, query ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, archiveStatus, currency, from, to, page]);

  function changeFilter(change: () => void) {
    setPage(1);
    change();
  }

  async function exportCsv() {
    setExporting(true);
    setError("");
    try {
      const response = await fetch(`/api/invoices?${requestParams(1, "csv").toString()}`);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Export archivu se nepodařilo připravit.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `archiv-faktur-${from || "zacatek"}-${to || "dnes"}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export archivu se nepodařilo připravit.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppFrame invoiceCount={activeCount}>
      <header className="section-header">
        <div>
          <Link href="/invoices" className="back-link">← Zpět na aktuální faktury</Link>
          <p>ARCHIV</p>
          <h1>Archiv faktur</h1>
          <span>Úplný přehled zaplacených a stornovaných faktur.</span>
        </div>
        <div className="section-actions">
          <button className="btn secondary" onClick={exportCsv} disabled={!total || exporting}>
            <Icon name="download" />
            {exporting ? "Připravuji…" : "Export CSV"}
          </button>
        </div>
      </header>

      <section className="page-panel filter-panel">
        <div className="filter-row archive-filter-row">
          <label className="grow">
            <span>Hledat</span>
            <input value={query} onChange={(event) => changeFilter(() => setQuery(event.target.value))} placeholder="Číslo faktury, odběratel, e-mail nebo VS" />
          </label>
          <label>
            <span>Stav</span>
            <select value={archiveStatus} onChange={(event) => changeFilter(() => setArchiveStatus(event.target.value as typeof archiveStatus))}>
              <option value="closed">Celý archiv</option>
              <option value="paid">Pouze zaplacené</option>
              <option value="cancelled">Pouze stornované</option>
            </select>
          </label>
          <label>
            <span>Měna</span>
            <select value={currency} onChange={(event) => changeFilter(() => setCurrency(event.target.value))}>
              <option value="all">Všechny měny</option>
              {currencies.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>Vystaveno od</span>
            <input type="date" value={from} max={to || undefined} onChange={(event) => changeFilter(() => setFrom(event.target.value))} />
          </label>
          <label>
            <span>Vystaveno do</span>
            <input type="date" value={to} min={from || undefined} onChange={(event) => changeFilter(() => setTo(event.target.value))} />
          </label>
        </div>
      </section>

      <section className="page-panel data-panel">
        {error ? <p className="page-state error-state">{error}</p>
          : loading ? <p className="page-state">Načítám archiv…</p>
          : !invoices.length ? <p className="page-state">V archivu tomuto filtru neodpovídá žádná faktura.</p>
          : (
            <div className="large-table invoice-list-table archive-invoice-table">
              <table>
                <thead>
                  <tr>
                    <th>Faktura</th><th>Odběratel</th><th>Částka</th><th>Vystavení</th>
                    <th>Splatnost</th><th>Datum úhrady</th><th>Stav</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="invoice-row" onClick={() => router.push(`/invoices/${invoice.id}`)}>
                      <td data-label="Faktura"><strong>{invoice.invoice_number}</strong><small>VS {invoice.variable_symbol || "—"}</small></td>
                      <td data-label="Odběratel"><strong>{invoice.counterparty_name}</strong><small>{invoice.counterparty_email}</small></td>
                      <td data-label="Částka"><strong>{money(Number(invoice.amount), invoice.currency)}</strong><small>Uhrazeno {money(Number(invoice.paid_amount), invoice.currency)}</small></td>
                      <td data-label="Vystavení">{date(invoice.issue_date)}</td>
                      <td data-label="Splatnost">{date(invoice.due_date)}</td>
                      <td data-label="Datum úhrady">{invoice.status === "paid" ? date(invoice.paid_at) : "—"}</td>
                      <td data-label="Stav"><span className={`status ${invoice.status}`}>{invoice.status === "paid" ? "Zaplaceno" : "Stornováno"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      {!error && totalPages > 1 && (
        <nav className="invoice-pagination" aria-label="Stránkování archivu">
          <button className="btn secondary" disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← Předchozí</button>
          <span>Strana <strong>{page}</strong> z {totalPages}</span>
          <button className="btn secondary" disabled={loading || page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Další →</button>
        </nav>
      )}
    </AppFrame>
  );
}
