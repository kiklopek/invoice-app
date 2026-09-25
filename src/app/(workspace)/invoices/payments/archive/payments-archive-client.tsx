"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppFrame } from "@/components/layout/app-shell";
import { Icon } from "@/components/icons";
import { confirmAction } from "@/lib/confirm-action";
import { apiFetch } from "@/lib/api-client";
import type { PaymentsPageData, PaymentsPagePayment, PaymentsPageOpenInvoice } from "@/lib/payments-page-data";
import { proposePaymentMatch } from "@/lib/payment-matching";
import { StatementArchive } from "./statement-archive";

type SavedPayment = PaymentsPagePayment;
type OpenInvoice = PaymentsPageOpenInvoice;
type PaymentSort = "default" | "amount_desc" | "amount_asc" | "name_asc" | "name_desc";

const money = (value: number, currency: string) =>
  new Intl.NumberFormat("cs-CZ", { style: "currency", currency }).format(value);
const statusLabel = {
  matched: "Spárováno",
  split: "Rozděleno na více faktur",
  unmatched: "Nenalezená faktura",
  ambiguous: "Vyžaduje kontrolu",
};
const matchStatusOrder: Record<SavedPayment["match_status"], number> = {
  matched: 0,
  split: 1,
  ambiguous: 2,
  unmatched: 3,
};

export function PaymentsArchiveClient({ initialData }: { initialData: PaymentsPageData }) {
  const [history, setHistory] = useState<SavedPayment[]>(initialData.payments);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>(initialData.open_invoices);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  // Once the accountant touches a payment's own select (even to clear it
  // back to empty), the auto-suggestion below must never overwrite that
  // deliberate choice again. Kept as state (not a ref) because whether a
  // payment is "touched" is read during render (to show/hide the suggestion
  // hint) -- reading a ref's current value during render isn't safe.
  const [touchedAssignments, setTouchedAssignments] = useState<Set<string>>(new Set());
  const [canManage, setCanManage] = useState(initialData.can_manage);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [unmatchedOnly, setUnmatchedOnly] = useState(false);
  const [paymentSort, setPaymentSort] = useState<PaymentSort>("default");

  const filteredHistory = useMemo(() => {
    const needle = historyQuery.trim().toLowerCase();
    return history
      .filter((payment) => {
        if (unmatchedOnly && payment.match_status !== "unmatched") return false;
        if (!needle) return true;
        const haystack = [
          payment.counterparty_name,
          payment.variable_symbol,
          payment.external_id,
          payment.invoices?.invoice_number,
          ...(payment.allocations ?? []).map((allocation) => allocation.invoice_number),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      })
      .sort((left, right) => {
        const dateFallback = right.booked_on.localeCompare(left.booked_on) || left.id.localeCompare(right.id);
        if (paymentSort === "amount_desc") return Number(right.amount) - Number(left.amount) || dateFallback;
        if (paymentSort === "amount_asc") return Number(left.amount) - Number(right.amount) || dateFallback;
        const leftName = left.counterparty_name || "Neznámá protistrana";
        const rightName = right.counterparty_name || "Neznámá protistrana";
        if (paymentSort === "name_asc") return leftName.localeCompare(rightName, "cs") || dateFallback;
        if (paymentSort === "name_desc") return rightName.localeCompare(leftName, "cs") || dateFallback;
        return matchStatusOrder[left.match_status] - matchStatusOrder[right.match_status] || dateFallback;
      });
  }, [history, historyQuery, unmatchedOnly, paymentSort]);

  async function refreshPayments() {
    const data = await apiFetch<PaymentsPageData>("/api/payments");
    setHistory(data.payments ?? []);
    setOpenInvoices(data.open_invoices ?? []);
    setCanManage(Boolean(data.can_manage));
  }

  async function assign(payment: SavedPayment) {
    const invoiceId = assignments[payment.id];
    if (!invoiceId) return;
    // Uvolnění platby potvrzení má, přiřazení ne -- přitom obojí mění
    // uhrazenou částku faktury. Nekonzistence učí uživatele, že se
    // nebezpečné akce někdy ptají a někdy ne.
    if (!(await confirmAction({
      title: "Přiřadit platbu k faktuře?",
      description: "Platba se zapíše k vybrané faktuře a změní její uhrazenou částku. Vrátit to lze uvolněním platby.",
      confirmLabel: "Přiřadit",
    }))) return;
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

  function candidatesFor(payment: SavedPayment) {
    return openInvoices.filter(
      (invoice) =>
        Number(payment.amount) <=
          Number(invoice.amount) - Number(invoice.paid_amount) &&
        invoice.currency === payment.currency,
    );
  }

  // Reuses the same safe-match rule the GPC import preview already relies on
  // (unique VS-or-invoice-number + currency + exact remaining amount) so a
  // payment that arrived before its invoice existed still gets found the
  // moment that invoice shows up here as "open" -- as a suggestion the
  // accountant confirms with one click, not a silent auto-match.
  function suggestedInvoiceId(payment: SavedPayment) {
    const proposal = proposePaymentMatch(
      { amount: Number(payment.amount), currency: payment.currency, variable_symbol: payment.variable_symbol },
      candidatesFor(payment),
    );
    return proposal.kind === "exact" && proposal.confidence === "safe" ? proposal.invoiceIds[0] : null;
  }

  useEffect(() => {
    setAssignments((current) => {
      let changed = false;
      const next = { ...current };
      for (const payment of history) {
        if (payment.match_status !== "unmatched") continue;
        if (touchedAssignments.has(payment.id) || next[payment.id]) continue;
        const suggestion = suggestedInvoiceId(payment);
        if (suggestion) {
          next[payment.id] = suggestion;
          changed = true;
        }
      }
      return changed ? next : current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, openInvoices, touchedAssignments]);

  function assignmentControl(payment: SavedPayment) {
    if (!canManage)
      return <small className="assignment-help">Pouze ke kontrole</small>;
    const candidates = candidatesFor(payment);
    if (!candidates.length)
      return (
        <small className="assignment-help">
          Žádná otevřená faktura se stejnou měnou a dostatečným zůstatkem
        </small>
      );
    const suggested = !touchedAssignments.has(payment.id) && suggestedInvoiceId(payment);
    return (
      <div className="payment-assignment">
        {suggested && (
          <small className="assignment-suggestion">
            Navržená shoda podle VS a částky. Před potvrzením ji zkontrolujte.
          </small>
        )}
        <select
          aria-label={`Vybrat fakturu pro platbu ${payment.external_id}`}
          value={assignments[payment.id] ?? ""}
          onChange={(event) => {
            setTouchedAssignments((current) => new Set(current).add(payment.id));
            setAssignments((current) => ({
              ...current,
              [payment.id]: event.target.value,
            }));
          }}
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
          className="btn primary compact"
          disabled={working || !assignments[payment.id]}
          onClick={() => assign(payment)}
        >
          Přiřadit
        </button>
      </div>
    );
  }

  return (
    <AppFrame className="content section-page payments-page payments-archive-page">
      <header className="section-header payments-hero">
        <div className="payments-hero-copy">
          <p>BANKOVNÍ PÁROVÁNÍ</p>
          <h1>Platby a archiv</h1>
          <span>Zkontrolujte zaúčtované platby, dopárujte nejasné úhrady a stáhněte si uložené bankovní výpisy.</span>
        </div>
        <div className="payments-hero-side">
          <Link href="/invoices/payments" className="payments-switch payments-switch-upload">
            <span className="payments-switch-icon"><Icon name="bank" /></span>
            <span className="payments-switch-copy">
              <strong>Nahrát výpis</strong>
              <small>Zpět na import a kontrolu bankovního výpisu</small>
            </span>
            <span className="payments-switch-arrow" aria-hidden="true"><Icon name="arrow-right" /></span>
          </Link>
        </div>
      </header>

      {message && <p className="form-error">{message}</p>}
      {notice && <p className="form-success">{notice}</p>}

      <section className="page-panel data-panel payments-history" id="historie-plateb">
        <header className="panel-head">
          <span className="payments-section-number">01</span>
          <div className="payments-section-heading">
            <small>HISTORIE A RUČNÍ KONTROLA</small>
            <h2>Poslední importované platby</h2>
            <p>
              U nejasné platby vyberte fakturu ručně. Nabízejí se otevřené
              faktury se stejnou měnou a dostatečným zůstatkem.
            </p>
          </div>
          <span className="payments-record-count">{filteredHistory.length} {filteredHistory.length === history.length ? "" : `z ${history.length} `}{filteredHistory.length === 1 ? "platba" : filteredHistory.length > 1 && filteredHistory.length < 5 ? "platby" : "plateb"}</span>
        </header>
        <div className="filter-row payments-history-toolbar">
          <label className="grow">
            <span>Hledat</span>
            <input
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="Protistrana, VS nebo číslo faktury"
            />
          </label>
          <label className="payments-history-sort">
            <span>Seřadit podle</span>
            <select value={paymentSort} onChange={(event) => setPaymentSort(event.target.value as PaymentSort)}>
              <option value="default">Stavu a data</option>
              <option value="amount_desc">Částky: nejvyšší</option>
              <option value="amount_asc">Částky: nejnižší</option>
              <option value="name_asc">Názvu: A–Z</option>
              <option value="name_desc">Názvu: Z–A</option>
            </select>
          </label>
          <label className="payments-unmatched-toggle">
            <input type="checkbox" checked={unmatchedOnly} onChange={(event) => setUnmatchedOnly(event.target.checked)} />
            <span>Jen nespárované</span>
          </label>
        </div>
        {filteredHistory.length ? (
          <div className="payment-history-table" role="list" aria-label="Importované platby">
            {filteredHistory.map((payment) => (
              <article className={`payment-history-item ${payment.match_status}`} role="listitem" key={payment.id}>
                <div className="payment-history-identity">
                  <strong>{payment.counterparty_name || "Neznámá protistrana"}</strong>
                  <div className="payment-history-meta">
                    <time dateTime={payment.booked_on}>{payment.booked_on}</time>
                    {payment.variable_symbol && <span>VS {payment.variable_symbol}</span>}
                  </div>
                </div>
                <div className="payment-history-summary">
                  <strong>{money(Number(payment.amount), payment.currency)}</strong>
                  <span className={`payment-match ${payment.match_status}`}>{statusLabel[payment.match_status]}</span>
                  {payment.source === "manual" && <small>Ručně potvrzeno</small>}
                </div>
                <div className="payment-history-action">
                  {payment.invoice_id || payment.allocations?.length ? (
                    <div className="payment-assignment matched-payment">
                      {(payment.allocations?.length ? payment.allocations : payment.invoice_id ? [{ invoice_id: payment.invoice_id, invoice_number: payment.invoices?.invoice_number || "Detail", amount: Number(payment.amount), counterparty_name: payment.invoices?.counterparty_name || "" }] : []).map(allocation => <Link key={allocation.invoice_id} href={`/invoices/${allocation.invoice_id}`}>
                        <span>Faktura {allocation.invoice_number}</span><strong>{money(Number(allocation.amount), payment.currency)}</strong><span aria-hidden="true">→</span>
                      </Link>)}
                      {canManage && (
                        <button type="button" className="btn secondary compact" disabled={working} onClick={() => unassign(payment)}>
                          Uvolnit přiřazení
                        </button>
                      )}
                    </div>
                  ) : assignmentControl(payment)}
                </div>
              </article>
            ))}
          </div>
        ) : history.length ? (
          <div className="payments-empty-state">
            <span><Icon name="bank" /></span>
            <strong>Žádná platba neodpovídá filtru</strong>
            <p>Zkuste jiné hledání, nebo vypněte &quot;Jen nespárované&quot;.</p>
          </div>
        ) : (
          <div className="payments-empty-state">
            <span><Icon name="bank" /></span>
            <strong>Žádné importované platby</strong>
            <p>Nahrajte první bankovní výpis a platby se objeví zde připravené ke kontrole.</p>
            <Link href="/invoices/payments">Přejít k nahrání výpisu</Link>
          </div>
        )}
      </section>

      <StatementArchive />
    </AppFrame>
  );
}
