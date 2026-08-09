"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Icon } from "@/components/icons";
import { MobileDisclosure } from "@/components/mobile-disclosure";
import {
  emptyDashboardData,
  type DashboardData,
} from "@/lib/dashboard-summary";

const money = (value: number, currency = "CZK") =>
  new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
const shortDate = (value: string) =>
  new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
const statusLabel = {
  pending: "Čeká na úhradu",
  overdue: "Po splatnosti",
  paid: "Zaplaceno",
  cancelled: "Stornováno",
};
const formatTotals = (totals: Record<string, number>) => {
  const rows = Object.entries(totals).sort(([a], [b]) => a.localeCompare(b));
  return rows.length
    ? rows
        .map(([currency, amount]) => money(Number(amount), currency))
        .join(" + ")
    : money(0);
};

export default function DashboardPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<DashboardData>(emptyDashboardData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/dashboard")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        return data;
      })
      .then((data) => setSummary(data))
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);

  const activeCount = summary.active_count;
  const recent = summary.recent;
  const upcoming = summary.upcoming;

  return (
    <div className="app-shell">
      <AppSidebar invoiceCount={activeCount} />
      <main className="content">
        <header className="topbar">
          <div>
            <p>R. Hlavica s.r.o. · účetní oddělení</p>
            <h1>Přehled pohledávek</h1>
          </div>
          <div className="top-actions dashboard-actions">
            <Link
              className="btn secondary dashboard-document-upload"
              href="/invoices/import"
            >
              <Icon name="upload" />
              Nahrát dokument
            </Link>
            <Link
              className="btn primary dashboard-add-invoice"
              href="/invoices/new"
            >
              <Icon name="plus" />
              Přidat fakturu
            </Link>
          </div>
        </header>
        <section className="metrics">
          <article>
            <div className="metric-icon green">
              <Icon name="invoice" />
            </div>
            <div>
              <p>Zbývá uhradit</p>
              <strong>{formatTotals(summary.open_totals)}</strong>
              <small>{activeCount} aktivních faktur</small>
            </div>
          </article>
          <article>
            <div className="metric-icon red">
              <Icon name="clock" />
            </div>
            <div>
              <p>Po splatnosti</p>
              <strong>{formatTotals(summary.overdue_totals)}</strong>
              <small className="negative">
                {summary.overdue_count} vyžaduje pozornost
              </small>
            </div>
          </article>
          <article>
            <div className="metric-icon blue">
              <Icon name="check" />
            </div>
            <div>
              <p>Celkem přijato</p>
              <strong>{formatTotals(summary.paid_totals)}</strong>
              <small>Včetně částečných úhrad</small>
            </div>
          </article>
          <article>
            <div className="metric-icon amber">
              <Icon name="mail" />
            </div>
            <div>
              <p>Odeslané upomínky</p>
              <strong>{summary.reminders_sent}</strong>
              <small>Automaticky evidováno</small>
            </div>
          </article>
        </section>
        <section className="workspace-grid">
          <div className="panel invoice-panel">
            <div className="panel-head">
              <div>
                <h2>Poslední faktury</h2>
                <p>Nejnověji přidané vydané faktury</p>
              </div>
              <Link href="/invoices">Zobrazit všechny →</Link>
            </div>
            {error ? (
              <p className="state error-state">{error}</p>
            ) : loading ? (
              <p className="state">Načítám faktury…</p>
            ) : (
              <div className="table-wrap dashboard-invoice-table">
                <table>
                  <thead>
                    <tr>
                      <th>Faktura</th>
                      <th>Odběratel</th>
                      <th>Částka</th>
                      <th>Splatnost</th>
                      <th>Upomínky</th>
                      <th>Stav</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((invoice) => (
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
                        <td data-label="Splatnost">
                          <strong
                            className={
                              invoice.status === "overdue" ? "red-text" : ""
                            }
                          >
                            {shortDate(invoice.due_date)}
                          </strong>
                        </td>
                        <td data-label="Upomínky">{invoice.reminders_sent}×</td>
                        <td data-label="Stav">
                          <span className={`status ${invoice.status}`}>
                            {statusLabel[invoice.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <MobileDisclosure label="Nadcházející upomínky" className="dashboard-upcoming-disclosure">
          <aside className="panel activity-panel">
            <div className="panel-head">
              <div>
                <h2>Nadcházející upomínky</h2>
                <p>Nejbližší automatické akce</p>
              </div>
            </div>
            <div className="timeline">
              {upcoming.length ? (
                upcoming.map((invoice) => (
                  <div key={invoice.id}>
                    <span className="timeline-icon amber">
                      <Icon name="mail" />
                    </span>
                    <section>
                      <small>{shortDate(invoice.next_reminder_at!)}</small>
                      <strong>{invoice.counterparty_name}</strong>
                      <p>
                        {invoice.invoice_number} · zbývá{" "}
                        {money(Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount)), invoice.currency)}
                      </p>
                      <em>
                        {invoice.status === "overdue"
                          ? "Faktura po splatnosti"
                          : "Naplánováno"}
                      </em>
                    </section>
                  </div>
                ))
              ) : (
                <p className="empty-box">Žádné nadcházející upomínky.</p>
              )}
            </div>
            <Link className="full-link" href="/reminders">
              Spravovat pravidla upomínek →
            </Link>
          </aside>
          </MobileDisclosure>
        </section>
      </main>
    </div>
  );
}
