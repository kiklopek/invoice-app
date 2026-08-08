"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppFrame } from "@/components/app-sidebar";
import { Icon } from "@/components/icons";
import { todayInTimeZone } from "@/lib/reminders";
import type { Invoice, InvoiceStatus } from "@/types/invoice";

const PAGE_SIZE = 25;
const money = (value: number, currency: string) =>
  new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
const date = (value: string) =>
  new Intl.DateTimeFormat("cs-CZ").format(new Date(value));
const labels: Record<InvoiceStatus, string> = {
  pending: "Čeká na úhradu",
  overdue: "Po splatnosti",
  paid: "Zaplaceno",
  cancelled: "Stornováno",
};

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [paymentCandidate, setPaymentCandidate] = useState<Invoice | null>(null);
  const [paymentDate, setPaymentDate] = useState(todayInTimeZone());
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | InvoiceStatus>("all");
  const [currency, setCurrency] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [openTotals, setOpenTotals] = useState<Record<string, number>>({});
  const [activeCount, setActiveCount] = useState(0);

  function requestParams(requestedPage = page, format?: "csv") {
    const params = new URLSearchParams({
      paged: "1",
      page: String(requestedPage),
    });
    if (query.trim()) params.set("q", query.trim());
    if (status !== "all") params.set("status", status);
    if (currency !== "all") params.set("currency", currency);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (format) params.set("format", format);
    return params;
  }

  useEffect(() => {
    const requestedStatus = new URLSearchParams(window.location.search).get(
      "status",
    );
    if (
      requestedStatus &&
      ["pending", "overdue", "paid", "cancelled"].includes(requestedStatus)
    )
      setStatus(requestedStatus as InvoiceStatus);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        setError("");
        fetch(`/api/invoices?${requestParams().toString()}`, {
          signal: controller.signal,
        })
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
            setOpenTotals(data.open_totals ?? {});
            setActiveCount(Number(data.active_count) || 0);
            setCanManage(Boolean(data.can_manage));
          })
          .catch((cause) => {
            if (cause instanceof Error && cause.name !== "AbortError")
              setError(cause.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      query ? 250 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, query, status, currency, from, to, page]);

  function changeFilter(change: () => void) {
    setPage(1);
    change();
  }
  async function exportCsv() {
    setExporting(true);
    setError("");
    try {
      const response = await fetch(
        `/api/invoices?${requestParams(1, "csv").toString()}`,
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Export se nepodařilo připravit.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `faktury-${from || "zacatek"}-${to || "dnes"}.csv`;
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

  async function confirmPayment() {
    if (!paymentCandidate) return;
    setConfirmingPayment(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/invoices/${paymentCandidate.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "paid", paid_on: paymentDate }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Úhradu se nepodařilo potvrdit.");

      const remaining = Math.max(
        0,
        Number(paymentCandidate.amount) - Number(paymentCandidate.paid_amount),
      );
      setInvoices((current) =>
        status === "pending" || status === "overdue"
          ? current.filter((item) => item.id !== paymentCandidate.id)
          : current.map((item) => item.id === paymentCandidate.id ? data.invoice : item),
      );
      setOpenTotals((current) => {
        const next = { ...current };
        next[paymentCandidate.currency] = Math.max(
          0,
          Number(next[paymentCandidate.currency] || 0) - remaining,
        );
        if (!next[paymentCandidate.currency]) delete next[paymentCandidate.currency];
        return next;
      });
      setActiveCount((current) => Math.max(0, current - 1));
      if (status === "pending" || status === "overdue") {
        const nextTotal = Math.max(0, total - 1);
        setTotal(nextTotal);
        setTotalPages(Math.max(1, Math.ceil(nextTotal / PAGE_SIZE)));
      }
      setNotice(`Úhrada faktury ${paymentCandidate.invoice_number} byla potvrzena.`);
      setPaymentCandidate(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Úhradu se nepodařilo potvrdit.");
    } finally {
      setConfirmingPayment(false);
    }
  }

  const firstShown = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastShown = Math.min(total, page * PAGE_SIZE);
  const outstanding = Object.entries(openTotals).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <AppFrame invoiceCount={activeCount}>
      <header className="section-header">
        <div>
          <p>POHLEDÁVKY</p>
          <h1>Faktury</h1>
          <span>
            Všechny vydané faktury, které čekají nebo čekaly na zaplacení.
          </span>
        </div>
        <div className="section-actions invoice-list-actions">
          <Link href="/invoices/archive" className="btn secondary">
            <Icon name="document" />
            Archiv
          </Link>
          <Link href="/invoices/import" className="btn secondary">
            <Icon name="upload" />
            Importovat
          </Link>
          <Link href="/invoices/new" className="btn primary">
            <Icon name="plus" />
            Nová faktura
          </Link>
        </div>
      </header>
      {notice && <p className="form-success">{notice}</p>}
      <section className="list-summary">
        <div>
          <span>Výsledek filtru</span>
          <strong>{total}</strong>
          <small>
            {total ? `zobrazeno ${firstShown}–${lastShown}` : "žádné faktury"}
          </small>
        </div>
        <div>
          <span>Otevřené ve výběru</span>
          <strong>
            {outstanding.length
              ? outstanding
                  .map(([code, amount]) => money(Number(amount), code))
                  .join(" + ")
              : money(0, currency === "all" ? "CZK" : currency)}
          </strong>
          <small>každá měna je počítána samostatně</small>
        </div>
      </section>
      <section className="page-panel filter-panel">
        <div className="filter-row">
          <label className="grow">
            <span>Hledat</span>
            <input
              value={query}
              onChange={(e) => changeFilter(() => setQuery(e.target.value))}
              placeholder="Číslo faktury, odběratel, e-mail nebo VS"
            />
          </label>
          <label>
            <span>Stav</span>
            <select
              value={status}
              onChange={(e) =>
                changeFilter(() => setStatus(e.target.value as typeof status))
              }
            >
              <option value="all">Všechny stavy</option>
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Měna</span>
            <select
              value={currency}
              onChange={(e) => changeFilter(() => setCurrency(e.target.value))}
            >
              <option value="all">Všechny měny</option>
              {currencies.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Vystaveno od</span>
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => changeFilter(() => setFrom(e.target.value))}
            />
          </label>
          <label>
            <span>Vystaveno do</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => changeFilter(() => setTo(e.target.value))}
            />
          </label>
          <button
            className="btn secondary export-button"
            onClick={exportCsv}
            disabled={!total || exporting}
          >
            <Icon name="download" />
            {exporting ? "Připravuji…" : "Export CSV"}
          </button>
        </div>
      </section>
      <section className="page-panel data-panel">
        {error ? (
          <p className="page-state error-state">{error}</p>
        ) : loading ? (
          <p className="page-state">Načítám faktury…</p>
        ) : !invoices.length ? (
          <p className="page-state">Tomuto filtru neodpovídá žádná faktura.</p>
        ) : (
          <div className="large-table invoice-list-table">
            <table>
              <thead>
                <tr>
                  <th>Faktura</th>
                  <th>Odběratel</th>
                  <th>Částka</th>
                  <th>Vystavení</th>
                  <th>Splatnost</th>
                  <th>Upomínky</th>
                  <th>Stav</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className="invoice-row"
                    onClick={(event) => {
                      const target = event.target;
                      if (target instanceof HTMLElement && target.closest("a, button, input, select, textarea")) return;
                      router.push(`/invoices/${invoice.id}`);
                    }}
                  >
                    <td data-label="Faktura">
                      <Link href={`/invoices/${invoice.id}`}>
                        <strong>{invoice.invoice_number}</strong>
                      </Link>
                      <small>VS {invoice.variable_symbol || "—"}</small>
                    </td>
                    <td data-label="Odběratel">
                      <strong>{invoice.counterparty_name}</strong>
                      <small>{invoice.counterparty_email}</small>
                    </td>
                    <td data-label="Částka">
                      <strong>
                        {money(Number(invoice.amount), invoice.currency)}
                      </strong>
                      {Number(invoice.paid_amount) > 0 &&
                      invoice.status !== "cancelled" ? (
                        <small>
                          Zbývá {money(Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount)), invoice.currency)}
                        </small>
                      ) : null}
                    </td>
                    <td data-label="Vystavení">{date(invoice.issue_date)}</td>
                    <td
                      data-label="Splatnost"
                      className={invoice.status === "overdue" ? "red-text" : ""}
                    >
                      {date(invoice.due_date)}
                    </td>
                    <td data-label="Upomínky">{invoice.reminders_sent}×</td>
                    <td data-label="Stav">
                      <span className={`status ${invoice.status}`}>
                        {labels[invoice.status]}
                      </span>
                    </td>
                    <td className="invoice-card-action">
                      {canManage && (invoice.status === "pending" || invoice.status === "overdue") ? (
                        <button
                          type="button"
                          className="btn primary quick-payment-button"
                          onClick={() => {
                            setPaymentDate(todayInTimeZone());
                            setPaymentCandidate(invoice);
                          }}
                        >
                          Potvrdit úhradu
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {!error && totalPages > 1 && (
        <nav className="invoice-pagination" aria-label="Stránkování faktur">
          <button
            className="btn secondary"
            disabled={loading || page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            ← Předchozí
          </button>
          <span>
            Strana <strong>{page}</strong> z {totalPages}
          </span>
          <button
            className="btn secondary"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
          >
            Další →
          </button>
        </nav>
      )}
      {paymentCandidate && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !confirmingPayment) setPaymentCandidate(null);
          }}
        >
          <section
            className="modal payment-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="list-payment-confirm-title"
          >
            <header>
              <div>
                <small>MANUÁLNÍ ÚHRADA</small>
                <h2 id="list-payment-confirm-title">
                  Opravdu potvrdit úhradu faktury {paymentCandidate.invoice_number}?
                </h2>
                <p>Faktura bude označena jako zaplacená zvoleným dnem a automatické upomínky se zastaví.</p>
              </div>
              <button
                type="button"
                aria-label="Zavřít potvrzení úhrady"
                disabled={confirmingPayment}
                onClick={() => setPaymentCandidate(null)}
              >
                ×
              </button>
            </header>
            <div className="payment-confirm-content">
              <div className="quick-payment-summary">
                <span>Odběratel</span>
                <strong>{paymentCandidate.counterparty_name}</strong>
                <span>Částka</span>
                <strong>{money(Number(paymentCandidate.amount), paymentCandidate.currency)}</strong>
              </div>
              <label className="quick-payment-date">
                <span>Datum úhrady</span>
                <input
                  type="date"
                  value={paymentDate}
                  max={todayInTimeZone()}
                  onChange={(event) => setPaymentDate(event.target.value)}
                />
                <small>Zadejte skutečný den, kdy byla částka připsána.</small>
              </label>
            </div>
            <footer className="payment-confirm-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={confirmingPayment || !paymentDate}
                onClick={() => setPaymentCandidate(null)}
              >
                Zrušit
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={confirmingPayment}
                onClick={confirmPayment}
              >
                {confirmingPayment ? "Ukládám…" : "Ano, potvrdit úhradu"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </AppFrame>
  );
}
