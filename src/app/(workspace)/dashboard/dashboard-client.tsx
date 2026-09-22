"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { AppFrame } from "@/components/layout/app-shell";
import { Icon } from "@/components/icons";
import { MobileDisclosure } from "@/components/mobile-disclosure";
import type { DashboardPageData } from "@/lib/dashboard-page-data";
import { canManageInvoices } from "@/lib/role-access";
import { useAccessProfile, useAccessRole } from "@/lib/use-access-role";

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
const isToday = (value: string) => {
  const date = new Date(value);
  const today = new Date();
  return date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
};
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

export function DashboardClient({ initialData }: { initialData: DashboardPageData }) {
  const router = useRouter();
  const role = useAccessRole();
  // Název firmy z profilu, ne natvrdo -- aplikace se má dát nasadit
  // i pro jinou firmu, aniž by se přepisovaly komponenty.
  const companyName = useAccessProfile()?.companyName?.trim();
  const canManage = canManageInvoices(role);
  const { data: summary = initialData, error: loadError } = useSWR<DashboardPageData>("/api/dashboard", { fallbackData: initialData, revalidateOnMount: false });
  const error = loadError instanceof Error ? loadError.message : "";

  const activeCount = summary.active_count;
  const recent = summary.recent;
  const upcoming = summary.upcoming;

  return (
    <AppFrame invoiceCount={activeCount} className="content dashboard-page">
        <header className="topbar">
          <div>
            <p>{companyName ? `${companyName} · účetní oddělení` : "Účetní oddělení"}</p>
            <h1>Finanční přehled</h1>
          </div>
          {canManage ? <div className="top-actions dashboard-actions">
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
          </div> : null}
        </header>
        <section className="dashboard-command" aria-label="Souhrn pohledávek">
          <article className="dashboard-balance-card">
            <div className="dashboard-balance-topline">
              <span>CELKOVĚ K ÚHRADĚ</span>
              <span className="dashboard-live-state"><i /> Aktuální stav</span>
            </div>
            <strong>{formatTotals(summary.open_totals)}</strong>
            <p>{activeCount} aktivních faktur čeká na úplné uhrazení</p>
            <div className="dashboard-balance-actions">
              <Link href="/invoices">Zobrazit pohledávky <span>→</span></Link>
              <Link href="/reports">Otevřít reporty</Link>
            </div>
          </article>
          <div className="dashboard-signal-grid">
            <article className="dashboard-signal critical">
              <span className="dashboard-signal-icon"><Icon name="clock" /></span>
              <div><small>Po splatnosti</small><strong>{formatTotals(summary.overdue_totals)}</strong><p>{summary.overdue_count} {summary.overdue_count === 1 ? "faktura vyžaduje" : "faktur vyžaduje"} pozornost</p></div>
            </article>
            <article className="dashboard-signal positive">
              <span className="dashboard-signal-icon"><Icon name="check" /></span>
              <div><small>Celkem přijato</small><strong>{formatTotals(summary.paid_totals)}</strong><p>Včetně částečných úhrad</p></div>
            </article>
            <article className="dashboard-signal neutral">
              <span className="dashboard-signal-icon"><Icon name="mail" /></span>
              <div><small>Odeslané upomínky</small><strong>{summary.reminders_sent}</strong><p>Automaticky evidováno</p></div>
            </article>
          </div>
        </section>
        <section className="workspace-grid dashboard-workspace">
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
                          {(invoice.status === "pending" || invoice.status === "overdue") &&
                          Number(invoice.paid_amount) > 0 ? (
                            <span className="status partial">Částečně uhrazeno</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <MobileDisclosure label="Vyžaduje pozornost" className="dashboard-upcoming-disclosure">
            <aside className="panel activity-panel dashboard-attention-panel">
              <div className="panel-head">
                <div>
                  <span className="dashboard-panel-eyebrow">PRIORITY</span>
                  <h2>Vyžaduje pozornost</h2>
                  <p>Co je potřeba řešit jako první</p>
                </div>
                <span
                  aria-label={`${upcoming.length} upozornění`}
                  className="dashboard-attention-count"
                >
                  {upcoming.length}
                </span>
              </div>
              <div className="timeline">
                {upcoming.length ? (
                  upcoming.map((invoice) => (
                    <Link
                      className="dashboard-timeline-item"
                      href={`/invoices/${invoice.id}`}
                      key={invoice.id}
                    >
                      <span className="timeline-icon amber">
                        <Icon name="mail" />
                      </span>
                      <section>
                        <small>{shortDate(invoice.next_reminder_at!)}</small>
                        {isToday(invoice.next_reminder_at!) ? <span className="today-task-tag">Dnešní úkol</span> : null}
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
                      <span className="dashboard-timeline-arrow" aria-hidden="true">→</span>
                    </Link>
                  ))
                ) : (
                  <p className="empty-box">Žádné nadcházející upomínky.</p>
                )}
              </div>
              {canManage ? <Link className="full-link" href="/reminders">
                Spravovat pravidla upomínek →
              </Link> : null}
            </aside>
          </MobileDisclosure>
        </section>
    </AppFrame>
  );
}
