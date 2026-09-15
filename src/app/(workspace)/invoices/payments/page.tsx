"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppFrame } from "@/components/layout/app-shell";
import { Icon } from "@/components/icons";
import { confirmAction } from "@/lib/confirm-action";
import { apiFetch, ApiRequestError } from "@/lib/api-client";
import { GpcImportPanel } from "./gpc-import-panel";

type SavedPayment = {
  id: string;
  external_id: string;
  booked_on: string;
  amount: number;
  currency: string;
  variable_symbol: string | null;
  counterparty_name: string | null;
  match_status: "matched" | "split" | "unmatched" | "ambiguous";
  source: "bank_import" | "manual";
  invoice_id: string | null;
  invoices?: { invoice_number: string; counterparty_name: string } | null;
  allocations?: Array<{ invoice_id: string; amount: number; invoice_number: string; counterparty_name: string }>;
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
  split: "Rozděleno na více faktur",
  unmatched: "Nenalezená faktura",
  ambiguous: "Vyžaduje kontrolu",
};

export default function PaymentImportPage() {
  const [history, setHistory] = useState<SavedPayment[]>([]);
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [canManage, setCanManage] = useState(false);
  const [gpcEnabled, setGpcEnabled] = useState<boolean | null>(null);
  const [gpcDiagnostic, setGpcDiagnostic] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");

  async function refreshPayments() {
    const data = await apiFetch<{ payments: SavedPayment[]; open_invoices: OpenInvoice[]; can_manage: boolean; gpc_enabled?: boolean; runtime_mode?: "production-database" }>("/api/payments");
    setHistory(data.payments ?? []);
    setOpenInvoices(data.open_invoices ?? []);
    setCanManage(Boolean(data.can_manage));
    setGpcEnabled(Boolean(data.gpc_enabled));
    setGpcDiagnostic(data.gpc_enabled ? null : "Import bankovních výpisů není pro vaši roli nebo toto prostředí povolený.");
    setPaymentsLoaded(true);
  }

  useEffect(() => {
    refreshPayments()
      .catch((cause) => {
        const requestId = cause instanceof ApiRequestError ? cause.requestId : null;
        const detail = `${cause instanceof Error ? cause.message : "Historii plateb se nepodařilo načíst."}${requestId ? ` ID požadavku: ${requestId}` : ""}`;
        // Zobrazit jen jednou v diagnostickém panelu importu, ne ještě
        // jednou v obecném banneru níže na stránce.
        setGpcEnabled(false);
        setPaymentsLoaded(true);
        setGpcDiagnostic(detail);
      });
  }, []);

  async function assign(payment: SavedPayment) {
    const invoiceId = assignments[payment.id];
    if (!invoiceId) return;
    setWorking(true);
    setMessage("");
    setNotice("");
    try {
      const data = await apiFetch<{
        settlement: "full" | "partial";
        invoice_number: string;
        remaining: number;
      }>("/api/payments", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": `assign-${payment.id}-${invoiceId}`,
        },
        body: JSON.stringify({ payment_id: payment.id, invoice_id: invoiceId }),
      });
      await refreshPayments();
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
      const data = await apiFetch<{ remaining?: number }>("/api/payments", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": `unassign-${payment.id}`,
        },
        body: JSON.stringify({ payment_id: payment.id }),
      });
      await refreshPayments();
      setNotice(typeof data.remaining === "number" ? `Platba byla uvolněna. Na faktuře nyní zbývá ${money(Number(data.remaining), payment.currency)}.` : "Všechna přiřazení platby byla bezpečně uvolněna.");
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

  return (
    <AppFrame className="content section-page payments-page">
      <header className="section-header payments-hero">
        <div className="payments-hero-copy">
          <Link href="/invoices" className="back-link">
            <Icon name="arrow-left" />
            Zpět na faktury
          </Link>
          <p>BANKOVNÍ PÁROVÁNÍ</p>
          <h1>Platby pod kontrolou</h1>
          <span>Importujte výpis, zkontrolujte návrhy a bezpečně spárujte úhrady s fakturami.</span>
        </div>
        <div className="payments-hero-side">
          <nav className="payments-jump-links" aria-label="Sekce bankovních plateb">
            <a href="#import-vypisu">Import</a>
            <a href="#archiv-vypisu">Archiv</a>
            <a href="#historie-plateb">Platby</a>
          </nav>
        </div>
      </header>

      <div id="import-vypisu" className="payments-anchor" />
      {gpcEnabled === null ? <section className="page-panel payments-loading"><span className="payments-loading-icon"><Icon name="upload" /></span><div><h2>Importovat bankovní výpis</h2><p>Ověřuji dostupnost bezpečného importu…</p></div></section> : gpcEnabled ? <GpcImportPanel invoices={openInvoices} canManage={canManage} onCommitted={() => void refreshPayments()} /> : <section className="page-panel payments-unavailable"><span className="payments-loading-icon payments-warning-icon"><Icon name="alert" /></span><div><h2>Import bankovního výpisu není dostupný</h2><p className="form-error" role="alert">{gpcDiagnostic ?? "Import momentálně není dostupný."}</p><p>Náhled ani potvrzení nezmění faktury, dokud není databázová migrace a oprávnění správně aktivní.</p></div></section>}
      {message && <p className="form-error">{message}</p>}
      {notice && <p className="form-success">{notice}</p>}

      <section className="page-panel data-panel payments-history" id="historie-plateb">
        <header className="panel-head">
          <span className="payments-section-number">03</span>
          <div className="payments-section-heading">
            <small>HISTORIE A RUČNÍ KONTROLA</small>
            <h2>Poslední importované platby</h2>
            <p>
              U nejasné platby vyberte fakturu ručně. Nabízejí se otevřené
              faktury se stejnou měnou a dostatečným zůstatkem.
            </p>
          </div>
          <span className="payments-record-count">{history.length} {history.length === 1 ? "platba" : history.length > 1 && history.length < 5 ? "platby" : "plateb"}</span>
        </header>
        {!paymentsLoaded ? (
          <p className="page-state">Načítám historii plateb…</p>
        ) : history.length ? (
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
                      {payment.source === "manual" && <small>Ručně potvrzeno</small>}
                    </td>
                    <td data-label="Přiřazení">
                      {payment.invoice_id || payment.allocations?.length ? (
                        <div className="payment-assignment matched-payment">
                          {(payment.allocations?.length ? payment.allocations : payment.invoice_id ? [{ invoice_id: payment.invoice_id, invoice_number: payment.invoices?.invoice_number || "Detail", amount: Number(payment.amount), counterparty_name: payment.invoices?.counterparty_name || "" }] : []).map(allocation => <Link key={allocation.invoice_id} href={`/invoices/${allocation.invoice_id}`}>
                            {allocation.invoice_number} · {money(Number(allocation.amount), payment.currency)} →
                          </Link>)}
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
          <div className="payments-empty-state">
            <span><Icon name="bank" /></span>
            <strong>Žádné importované platby</strong>
            <p>Nahrajte první bankovní výpis a platby se objeví zde připravené ke kontrole.</p>
            <a href="#import-vypisu">Přejít k importu</a>
          </div>
        )}
      </section>
    </AppFrame>
  );
}
