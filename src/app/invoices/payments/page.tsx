"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppFrame } from "@/components/app-sidebar";
import { Icon } from "@/components/icons";
import { createCsv } from "@/lib/csv";
import { parsePaymentCsv, type PaymentImportRow } from "@/lib/payment-import";
import { confirmAction } from "@/lib/confirm-action";

type Result = {
  external_id: string;
  status: "matched" | "unmatched" | "ambiguous" | "duplicate";
  invoice_id?: string;
  invoice_number?: string;
  settlement?: "full" | "partial";
  remaining?: number;
};
type Summary = {
  imported: number;
  matched: number;
  partial_matched: number;
  unmatched: number;
  ambiguous: number;
  duplicates: number;
  results: Result[];
};
type SavedPayment = {
  id: string;
  external_id: string;
  booked_on: string;
  amount: number;
  currency: string;
  variable_symbol: string | null;
  counterparty_name: string | null;
  match_status: "matched" | "unmatched" | "ambiguous";
  invoice_id: string | null;
  invoices?: { invoice_number: string; counterparty_name: string } | null;
};
type OpenInvoice = {
  id: string;
  invoice_number: string;
  counterparty_name: string;
  amount: number;
  paid_amount: number;
  currency: string;
  variable_symbol: string | null;
};

const money = (value: number, currency: string) =>
  new Intl.NumberFormat("cs-CZ", { style: "currency", currency }).format(value);
const statusLabel = {
  matched: "Spárováno",
  unmatched: "Nenalezená faktura",
  ambiguous: "Více možných faktur",
  duplicate: "Již importováno",
};

export default function PaymentImportPage() {
  const [rows, setRows] = useState<PaymentImportRow[]>([]);
  const [history, setHistory] = useState<SavedPayment[]>([]);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [canManage, setCanManage] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/payments")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setHistory(data.payments ?? []);
        setOpenInvoices(data.open_invoices ?? []);
        setCanManage(Boolean(data.can_manage));
      })
      .catch((cause) =>
        setMessage(
          cause instanceof Error
            ? cause.message
            : "Historii plateb se nepodařilo načíst.",
        ),
      );
  }, []);

  async function load(selected: File | null) {
    setRows([]);
    setSummary(null);
    setMessage("");
    setNotice("");
    if (!selected) return;
    try {
      setRows(parsePaymentCsv(await selected.text()));
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "CSV se nepodařilo načíst.",
      );
    }
  }

  async function submit() {
    setWorking(true);
    setMessage("");
    setNotice("");
    try {
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payments: rows }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSummary(data);
      setRows([]);
      const historyResponse = await fetch("/api/payments");
      if (historyResponse.ok) {
        const refreshed = await historyResponse.json();
        setHistory(refreshed.payments ?? []);
        setOpenInvoices(refreshed.open_invoices ?? []);
        setCanManage(Boolean(refreshed.can_manage));
      }
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Platby se nepodařilo importovat.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function assign(payment: SavedPayment) {
    const invoiceId = assignments[payment.id];
    if (!invoiceId) return;
    setWorking(true);
    setMessage("");
    setNotice("");
    try {
      const response = await fetch("/api/payments", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payment_id: payment.id, invoice_id: invoiceId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const historyResponse = await fetch("/api/payments");
      if (historyResponse.ok) {
        const refreshed = await historyResponse.json();
        setHistory(refreshed.payments ?? []);
        setOpenInvoices(refreshed.open_invoices ?? []);
      }
      setAssignments((current) => {
        const next = { ...current };
        delete next[payment.id];
        return next;
      });
      setNotice(
        data.settlement === "partial"
          ? `Platba je přiřazená k faktuře ${data.invoice_number}. K úhradě zbývá ${money(Number(data.remaining), payment.currency)}.`
          : `Platba je přiřazená k faktuře ${data.invoice_number}. Faktura je plně zaplacená a upomínky jsou zastavené.`,
      );
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Platbu se nepodařilo přiřadit.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function unassign(payment: SavedPayment) {
    if (
      !await confirmAction({
        title: "Uvolnit tuto platbu z faktury?",
        description: "Zůstatek faktury a její upomínky se automaticky přepočítají.",
        confirmLabel: "Uvolnit platbu",
      })
    )
      return;
    setWorking(true);
    setMessage("");
    setNotice("");
    try {
      const response = await fetch("/api/payments", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payment_id: payment.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const historyResponse = await fetch("/api/payments");
      if (historyResponse.ok) {
        const refreshed = await historyResponse.json();
        setHistory(refreshed.payments ?? []);
        setOpenInvoices(refreshed.open_invoices ?? []);
      }
      setNotice(
        `Platba byla uvolněna. Na faktuře nyní zbývá ${money(Number(data.remaining), payment.currency)}.`,
      );
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Platbu se nepodařilo uvolnit.",
      );
    } finally {
      setWorking(false);
    }
  }

  function assignmentControl(payment: SavedPayment) {
    if (!canManage)
      return <small className="assignment-help">Pouze ke kontrole</small>;
    const candidates = openInvoices.filter(
      (invoice) =>
        Number(payment.amount) <=
          Number(invoice.amount) - Number(invoice.paid_amount) &&
        invoice.currency === payment.currency,
    );
    if (!candidates.length)
      return (
        <small className="assignment-help">
          Žádná otevřená faktura se stejnou měnou a dostatečným zůstatkem
        </small>
      );
    return (
      <div className="payment-assignment">
        <select
          aria-label={`Vybrat fakturu pro platbu ${payment.external_id}`}
          value={assignments[payment.id] ?? ""}
          onChange={(event) =>
            setAssignments((current) => ({
              ...current,
              [payment.id]: event.target.value,
            }))
          }
        >
          <option value="">Vyberte fakturu…</option>
          {candidates.map((invoice) => (
            <option key={invoice.id} value={invoice.id}>
              {invoice.invoice_number} · {invoice.counterparty_name} · zbývá{" "}
              {money(
                Number(invoice.amount) - Number(invoice.paid_amount),
                invoice.currency,
              )}{" "}
              · VS {invoice.variable_symbol || "—"}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn secondary compact"
          disabled={working || !assignments[payment.id]}
          onClick={() => assign(payment)}
        >
          Přiřadit
        </button>
      </div>
    );
  }

  function downloadTemplate() {
    const csv = createCsv([
      [
        "ID transakce",
        "Datum",
        "Částka",
        "Měna",
        "Variabilní symbol",
        "Protistrana",
        "Účet protistrany",
        "Poznámka",
      ],
      [
        "BANK-2026-0001",
        "2026-08-06",
        12500,
        "CZK",
        "2026001",
        "Ukázkový odběratel s.r.o.",
        "CZ0000000000000000000000",
        "Úhrada faktury",
      ],
    ]);
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "vzor-importu-bankovnich-plateb.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppFrame>
      <header className="section-header">
        <div>
          <Link href="/invoices" className="back-link">
            <Icon name="arrow-left" />
            Zpět na faktury
          </Link>
          <p>KONTROLA ÚHRAD</p>
          <h1>Bankovní platby</h1>
          <span>
            Nahrajte export z banky. Aplikace bezpečně rozpozná i částečné
            úhrady a vždy ukáže zbývající částku.
          </span>
        </div>
      </header>

      <section className="page-panel import-panel payment-import-panel">
        <div className="csv-help">
          <h2>Načíst příchozí platby</h2>
          <p>
            Povinné jsou ID transakce, datum, částka a měna. Pro automatické
            spárování je potřeba také variabilní symbol. Stejné ID nelze
            importovat dvakrát.
          </p>
          <div className="csv-actions">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => load(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="btn secondary"
              onClick={downloadTemplate}
            >
              <Icon name="download" />
              Stáhnout vzor CSV
            </button>
          </div>
        </div>
        {rows.length > 0 && (
          <>
            <div className="import-preview">
              <strong>Před uložením zkontrolujte {rows.length} plateb</strong>
              <div className="large-table payment-preview-table">
                <table>
                  <thead>
                    <tr>
                      <th>ID transakce</th>
                      <th>Datum</th>
                      <th>Protistrana</th>
                      <th>VS</th>
                      <th>Částka</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 12).map((row) => (
                      <tr key={row.external_id}>
                        <td data-label="ID transakce">{row.external_id}</td>
                        <td data-label="Datum">{row.booked_on}</td>
                        <td data-label="Protistrana">{row.counterparty_name || "—"}</td>
                        <td data-label="Variabilní symbol">{row.variable_symbol || "—"}</td>
                        <td data-label="Částka">
                          <strong>{money(row.amount, row.currency)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 12 && (
                <small>…a dalších {rows.length - 12} plateb</small>
              )}
            </div>
            <button
              className="btn primary import-confirm"
              disabled={working}
              onClick={submit}
            >
              {working ? (
                "Páruji…"
              ) : (
                <>
                  <Icon name="check" />
                  Importovat a bezpečně spárovat
                </>
              )}
            </button>
          </>
        )}
      </section>
      {message && <p className="form-error">{message}</p>}
      {notice && <p className="form-success">{notice}</p>}

      {summary && (
        <section className="payment-result">
          <div>
            <span>Nově importováno</span>
            <strong>{summary.imported}</strong>
          </div>
          <div className="good">
            <span>Spárováno</span>
            <strong>{summary.matched}</strong>
            <small>{summary.partial_matched || 0} částečně</small>
          </div>
          <div>
            <span>K ruční kontrole</span>
            <strong>{summary.unmatched + summary.ambiguous}</strong>
          </div>
          <div>
            <span>Přeskočené duplicity</span>
            <strong>{summary.duplicates}</strong>
          </div>
        </section>
      )}
      {summary?.results?.length ? (
        <section className="page-panel data-panel">
          <header className="panel-head">
            <div>
              <h2>Výsledek posledního importu</h2>
              <p>Nejasné platby nikdy automaticky nemění fakturu.</p>
            </div>
          </header>
          <div className="large-table payment-result-table">
            <table>
              <thead>
                <tr>
                  <th>ID transakce</th>
                  <th>Výsledek</th>
                  <th>Faktura</th>
                </tr>
              </thead>
              <tbody>
                {summary.results.map((item) => (
                  <tr key={item.external_id}>
                    <td data-label="ID transakce">{item.external_id}</td>
                    <td data-label="Výsledek">
                      <span className={`payment-match ${item.status}`}>
                        {item.status === "matched" &&
                        item.settlement === "partial"
                          ? "Částečně spárováno"
                          : statusLabel[item.status]}
                      </span>
                      {item.settlement === "partial" &&
                      typeof item.remaining === "number" ? (
                        <small>Zbývá {money(item.remaining, "CZK")}</small>
                      ) : null}
                    </td>
                    <td data-label="Faktura">
                      {item.invoice_id ? (
                        <Link href={`/invoices/${item.invoice_id}`}>
                          {item.invoice_number} →
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="page-panel data-panel">
        <header className="panel-head">
          <div>
            <h2>Poslední importované platby</h2>
            <p>
              U nejasné platby vyberte fakturu ručně. Nabízejí se otevřené
              faktury se stejnou měnou a dostatečným zůstatkem.
            </p>
          </div>
        </header>
        {history.length ? (
          <div className="large-table payment-history-table">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Protistrana</th>
                  <th>VS</th>
                  <th>Částka</th>
                  <th>Stav</th>
                  <th>Faktura nebo ruční přiřazení</th>
                </tr>
              </thead>
              <tbody>
                {history.map((payment) => (
                  <tr key={payment.id}>
                    <td data-label="Datum">{payment.booked_on}</td>
                    <td data-label="Protistrana">
                      {payment.counterparty_name || "—"}
                      <small>{payment.external_id}</small>
                    </td>
                    <td data-label="Variabilní symbol">
                      {payment.variable_symbol || "—"}
                    </td>
                    <td data-label="Částka">
                      <strong>
                        {money(Number(payment.amount), payment.currency)}
                      </strong>
                    </td>
                    <td data-label="Stav">
                      <span className={`payment-match ${payment.match_status}`}>
                        {statusLabel[payment.match_status]}
                      </span>
                    </td>
                    <td data-label="Přiřazení">
                      {payment.invoice_id ? (
                        <div className="payment-assignment matched-payment">
                          <Link href={`/invoices/${payment.invoice_id}`}>
                            {payment.invoices?.invoice_number || "Detail"} →
                          </Link>
                          {canManage && (
                            <button
                              type="button"
                              className="btn secondary compact"
                              disabled={working}
                              onClick={() => unassign(payment)}
                            >
                              Uvolnit
                            </button>
                          )}
                        </div>
                      ) : (
                        assignmentControl(payment)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="page-state">
            Zatím nebyla importována žádná bankovní platba.
          </p>
        )}
      </section>
    </AppFrame>
  );
}
