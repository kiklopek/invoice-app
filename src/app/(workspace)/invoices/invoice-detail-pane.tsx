"use client";

import Link from "next/link";
import { ExactMoney } from "@/components/money-amount";
import { Icon } from "@/components/icons";
import type { Invoice } from "@/types/invoice";
import {
  invoiceDate,
  invoiceDueContext,
  invoiceMoney,
  invoicePaidPercentage,
  invoiceReminderSummary,
  invoiceStatusLabels,
} from "./invoice-list-presentation";
import styles from "./invoices.module.css";

/** Windows at least this wide show the detail pane next to the list (CSS uses the same value). */
export const INVOICE_DETAIL_PANE_QUERY = "(min-width: 2200px)";

/**
 * Detail of the selected invoice beside the list on very wide windows
 * (TRANSITION_RULES pravidlo 11: the extra width carries content, not empty space).
 * It shows only what the list already loaded and offers only existing actions:
 * confirming a payment opens the same confirmation dialog as the row menu;
 * reminders are sent from the invoice detail, never from here.
 */
export function InvoiceDetailPane({
  invoice,
  canManage,
  today,
  onConfirm,
}: {
  invoice: Invoice | null;
  canManage: boolean;
  today: string;
  onConfirm: (invoice: Invoice) => void;
}) {
  if (!invoice)
    return (
      <aside className={styles.detailPane} aria-label="Detail vybrané faktury">
        <p className={styles.detailEmpty}>Vyberte fakturu v seznamu.</p>
      </aside>
    );
  const open = invoice.status === "pending" || invoice.status === "overdue";
  const amount = Number(invoice.amount);
  const paid = Number(invoice.paid_amount);
  const partial = open && paid > 0;
  const percentage = invoicePaidPercentage(amount, paid);
  const reminders = invoiceReminderSummary(invoice);
  return (
    <aside
      className={styles.detailPane}
      aria-label={`Detail faktury ${invoice.invoice_number}`}
    >
      <div className={styles.detailBody}>
        <header className={styles.detailHead}>
          <div>
            <small>Faktura</small>
            <h2>{invoice.invoice_number}</h2>
          </div>
          <span
            className={styles.badge}
            data-status={partial ? "partial" : invoice.status}
          >
            {partial ? "Částečně uhrazeno" : invoiceStatusLabels[invoice.status]}
          </span>
        </header>
        <section className={styles.detailAmount} aria-label="Částka">
          <strong>
            <ExactMoney value={amount} currency={invoice.currency} />
          </strong>
          <span className={styles.progress} aria-hidden="true">
            <i style={{ width: `${percentage}%` }} />
          </span>
          <small>
            Uhrazeno {invoiceMoney(paid, invoice.currency)}
            {open ? ` · zbývá ${invoiceMoney(Math.max(0, amount - paid), invoice.currency)}` : ""}
          </small>
        </section>
        <dl className={styles.detailFacts}>
          <div>
            <dt>Odběratel</dt>
            <dd>
              <strong>{invoice.counterparty_name}</strong>
              <span>{invoice.counterparty_email || "—"}</span>
            </dd>
          </div>
          <div>
            <dt>Variabilní symbol</dt>
            <dd>{invoice.variable_symbol || "—"}</dd>
          </div>
          <div>
            <dt>Vystaveno</dt>
            <dd>{invoiceDate(invoice.issue_date)}</dd>
          </div>
          <div>
            <dt>Splatnost</dt>
            <dd>
              {invoiceDate(invoice.due_date)}
              <span data-overdue={open && invoice.due_date < today}>
                {invoiceDueContext(invoice, today)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Upomínky</dt>
            <dd>
              {reminders.main}
              {reminders.detail ? <span>{reminders.detail}</span> : null}
            </dd>
          </div>
          {invoice.reminder_policy?.name ? (
            <div>
              <dt>Kategorie upomínek</dt>
              <dd>{invoice.reminder_policy.name}</dd>
            </div>
          ) : null}
        </dl>
      </div>
      <footer className={styles.detailActions}>
        {canManage && open ? (
          <button type="button" className={styles.detailPrimary} onClick={() => onConfirm(invoice)}>
            <Icon name="check" />
            Potvrdit úhradu
          </button>
        ) : null}
        <Link href={`/invoices/${invoice.id}`} className={styles.detailSecondary}>
          Otevřít detail
        </Link>
        <Link href={`/invoices/${invoice.id}#invoice-reminders`} className={styles.detailLink}>
          Upomínky a historie
        </Link>
      </footer>
    </aside>
  );
}
