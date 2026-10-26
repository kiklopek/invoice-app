"use client";

import { ExactMoney } from "@/components/money-amount";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import type { Invoice } from "@/types/invoice";
import {
  invoiceDate,
  invoiceMoney,
  invoiceDueContext,
  invoicePaidPercentage,
  invoiceStatusLabels,
  sortInvoicePage,
  type InvoiceSort,
  type InvoiceSortOrder,
} from "./invoice-list-presentation";
import { InvoiceRowActions } from "./invoice-row-actions";
import styles from "./invoices.module.css";
function SelectAll({
  checked,
  mixed,
  onChange,
}: {
  checked: boolean;
  mixed: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label="Vybrat všechny faktury na stránce"
    />
  );
}
export function InvoiceListTable({
  invoices,
  canManage,
  today,
  onConfirm,
  onOpen,
  onPrefetch,
  sortOrder,
  onSortChange,
  onExportSelected,
  exporting,
}: {
  onExportSelected: (ids: string[]) => void;
  exporting: boolean;
  invoices: Invoice[];
  canManage: boolean;
  today: string;
  onConfirm: (invoice: Invoice) => void;
  onOpen: (id: string) => void;
  onPrefetch: (id: string) => void;
  sortOrder: InvoiceSortOrder;
  onSortChange: (order: InvoiceSortOrder) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { field: sort, direction } = sortOrder;
  const { showToast } = useToast(),
    rows = sortInvoicePage(invoices, sort, direction),
    selectedRows = invoices.filter((invoice) => selected.has(invoice.id));
  function order(key: InvoiceSort) {
    onSortChange({
      field: key,
      direction:
        key !== "counterparty_name" && sort === key && direction === "asc"
          ? "desc"
          : "asc",
    });
  }
  async function copySelected() {
    try {
      await navigator.clipboard.writeText(
        selectedRows.map((invoice) => invoice.invoice_number).join("\n"),
      );
      showToast({
        variant: "success",
        message: "Čísla vybraných faktur byla zkopírována.",
      });
    } catch {
      showToast({
        variant: "error",
        message: "Čísla faktur se nepodařilo zkopírovat.",
      });
    }
  }
  const heading = (key: InvoiceSort, label: string) => (
    <button
      type="button"
      onClick={() => order(key)}
      title={`Seřadit aktuální stránku: ${label}`}
    >
      {label}
      {sort === key ? (
        <span aria-hidden="true">{direction === "asc" ? "↑" : "↓"}</span>
      ) : null}
    </button>
  );
  return (
    <>
      {selectedRows.length ? (
        <div className={styles.selectionBar}>
          <strong>Vybráno: {selectedRows.length}</strong>
          <button type="button" disabled={exporting} onClick={() => onExportSelected(selectedRows.map(invoice => invoice.id))}>
            <Icon name="download"/>{exporting ? "Připravuji…" : "Export do Excelu"}
          </button>
          <button type="button" onClick={() => void copySelected()}>
            Zkopírovat čísla
          </button>
          <button type="button" onClick={() => setSelected(new Set())}>
            Zrušit výběr
          </button>
        </div>
      ) : null}
      {sort !== "default" ? (
        <div className={styles.sortNotice}>
          Seřazena aktuální stránka{" "}
          <button
            type="button"
            onClick={() => onSortChange({ field: "default", direction: "asc" })}
          >
            Vrátit výchozí řazení
          </button>
        </div>
      ) : null}
      <div
        className={styles.tableScroll}
        data-invoice-table
        tabIndex={0}
        role="region"
        aria-label="Seznam faktur"
      >
        <table className={styles.table}>
          <caption className={styles.srOnly}>
            Všechny faktury. Sloupce lze seřadit v rámci aktuální stránky.
          </caption>
          <colgroup>
            <col className={styles.checkCol} />
            <col className={styles.numberCol} />
            <col className={styles.customerCol} />
            <col className={styles.amountCol} />
            <col className={styles.dueCol} />
            <col className={styles.statusCol} />
            <col className={styles.paidCol} />
            <col className={styles.actionsCol} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">
                <SelectAll
                  checked={
                    selectedRows.length === invoices.length &&
                    invoices.length > 0
                  }
                  mixed={
                    selectedRows.length > 0 &&
                    selectedRows.length < invoices.length
                  }
                  onChange={() =>
                    setSelected(
                      selectedRows.length === invoices.length
                        ? new Set()
                        : new Set(invoices.map((invoice) => invoice.id)),
                    )
                  }
                />
              </th>
              <th
                scope="col"
                aria-sort={
                  sort === "invoice_number"
                    ? direction === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
              >
                {heading("invoice_number", "Faktura")}
              </th>
              <th
                scope="col"
                aria-sort={
                  sort === "counterparty_name"
                    ? direction === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
              >
                {heading("counterparty_name", "Odběratel")}
              </th>
              <th
                scope="col"
                aria-sort={
                  sort === "amount"
                    ? direction === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
              >
                {heading("amount", "Částka")}
              </th>
              <th
                scope="col"
                aria-sort={
                  sort === "due_date"
                    ? direction === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
              >
                {heading("due_date", "Splatnost")}
              </th>
              <th scope="col">Stav</th>
              <th
                scope="col"
                aria-sort={
                  sort === "paid_amount"
                    ? direction === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
              >
                {heading("paid_amount", "Uhrazeno")}
              </th>
              <th scope="col">
                <span className={styles.srOnly}>Akce</span>
                <Icon name="more" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((invoice) => {
              const isOpen =
                  invoice.status === "pending" || invoice.status === "overdue",
                partial = isOpen && Number(invoice.paid_amount) > 0;
              const percentage = invoicePaidPercentage(
                Number(invoice.amount),
                Number(invoice.paid_amount),
              );
              return (
                <tr
                  key={invoice.id}
                  data-invoice-id={invoice.id}
                  data-partial={partial || undefined}
                  onMouseEnter={() => onPrefetch(invoice.id)}
                  onTouchStart={() => onPrefetch(invoice.id)}
                  onClick={(event) => {
                    if (window.getSelection()?.toString()) return;
                    if (
                      event.target instanceof Element &&
                      event.target.closest("a,button,input,select,summary")
                    )
                      return;
                    onOpen(invoice.id);
                  }}
                >
                  <td className={styles.selectionCell}>
                    <input
                      type="checkbox"
                      aria-label={`Vybrat fakturu ${invoice.invoice_number}`}
                      checked={selected.has(invoice.id)}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(invoice.id)) next.delete(invoice.id);
                          else next.add(invoice.id);
                          return next;
                        })
                      }
                    />
                    <span className={styles.mobileDocumentIcon} aria-hidden="true"><Icon name="file-invoice"/></span>
                  </td>
                  <td className={styles.numberCell}>
                    <Link
                      href={`/invoices/${invoice.id}`}
                      title={invoice.invoice_number}
                      onFocus={() => onPrefetch(invoice.id)}
                    >
                      {invoice.invoice_number}
                    </Link>
                    <small
                      title={`Variabilní symbol ${invoice.variable_symbol || "neuveden"}`}
                    >
                      VS {invoice.variable_symbol || "—"}
                    </small>
                  </td>
                  <td className={styles.customerCell}>
                    <strong title={invoice.counterparty_name}>
                      {invoice.counterparty_name}
                    </strong>
                    <small title={invoice.counterparty_email}>
                      {invoice.counterparty_email || "—"}
                    </small>
                  </td>
                  <td className={styles.amountCell}>
                    <span className={styles.mobileLabel}>Částka</span>
                    <strong>
                      <ExactMoney value={Number(invoice.amount)} currency={invoice.currency} />
                    </strong>
                  </td>
                  <td
                    className={styles.dueCell}
                    data-overdue={isOpen && invoice.due_date < today}
                  >
                    <time dateTime={invoice.due_date}>
                      {invoiceDate(invoice.due_date)}
                    </time>
                    <small>{invoiceDueContext(invoice, today)}</small>
                  </td>
                  <td className={styles.statusCell}>
                    <span
                      className={styles.badge}
                      data-status={partial ? "partial" : invoice.status}
                      title={`${invoiceStatusLabels[invoice.status]}${partial ? " · Částečně uhrazeno" : ""}`}
                    >
                      {invoice.status === "paid" ? (
                        <Icon name="check" />
                      ) : invoice.status === "overdue" && !partial ? (
                        <Icon name="clock" />
                      ) : null}
                      {partial
                        ? "Částečně uhrazeno"
                        : invoiceStatusLabels[invoice.status]}
                    </span>
                  </td>
                  <td className={styles.paidCell}>
                    <span className={styles.mobileLabel}>Uhrazeno</span>
                    <div className={styles.paidInfo}>
                      <span>
                        {invoiceMoney(
                          Number(invoice.paid_amount),
                          invoice.currency,
                        )}
                      </span>
                      <span
                        className={styles.progress}
                        role="progressbar"
                        aria-label={`Úhrada faktury ${invoice.invoice_number}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percentage}
                        aria-valuetext={`${invoiceMoney(Number(invoice.paid_amount), invoice.currency)} z ${invoiceMoney(Number(invoice.amount), invoice.currency)}`}
                      >
                        <i style={{ width: `${percentage}%` }} />
                      </span>
                      <small>
                        {new Intl.NumberFormat("cs-CZ", {
                          maximumFractionDigits: 0,
                        }).format(percentage)}{" "}
                        %
                      </small>
                    </div>
                  </td>
                  <td className={styles.actionsCell}>
                    <InvoiceRowActions
                      invoice={invoice}
                      canManage={canManage}
                      onConfirm={onConfirm}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
