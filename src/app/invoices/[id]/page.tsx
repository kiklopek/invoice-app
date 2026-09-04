"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppFrame } from "@/components/app-sidebar";
import { MobileDisclosure } from "@/components/mobile-disclosure";
import { InvoiceForm } from "@/components/invoice-form";
import { todayInTimeZone } from "@/lib/reminders";
import { confirmAction } from "@/lib/confirm-action";
import type {
  Invoice,
  InvoiceInput,
  InvoiceStatus,
  ReminderStage,
} from "@/types/invoice";

type DeliveryStatus =
  "accepted" | "delivered" | "delayed" | "bounced" | "complained" | "failed";
type ReminderRecord = {
  id: string;
  stage: ReminderStage;
  scheduled_for: string;
  sent_at: string | null;
  sent_to: string;
  status: "queued" | "sent" | "failed" | "skipped";
  attempt_count: number;
  error_message: string | null;
  delivery_status: DeliveryStatus | null;
  delivery_event_at: string | null;
  delivered_at: string | null;
  delivery_error: string | null;
};
type EmailSuppression = {
  reason: "bounced" | "complained";
  last_event_at: string;
};
type ActivityRecord = {
  id: string;
  event_type:
    | "created"
    | "updated"
    | "paid"
    | "reopened"
    | "cancelled"
    | "overdue"
    | "reminders_paused"
    | "reminders_resumed"
    | "payment_changed";
  details: {
    fields?: string[];
    paid_at?: string;
    corrected?: boolean;
    detached_payments?: number;
    from?: number;
    to?: number;
    remaining?: number;
  };
  actor_email: string | null;
  created_at: string;
};
type BankPayment = {
  id: string;
  external_id: string;
  booked_on: string;
  amount: number;
  currency: string;
  variable_symbol: string | null;
  counterparty_name: string | null;
  counterparty_account: string | null;
  note: string | null;
  matched_at: string | null;
};
const money = (value: number, currency: string) =>
  new Intl.NumberFormat("cs-CZ", { style: "currency", currency }).format(value);
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("cs-CZ", { dateStyle: "long" }).format(
        new Date(value),
      )
    : "—";
const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("cs-CZ", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
const statusLabels: Record<InvoiceStatus, string> = {
  pending: "Čeká na úhradu",
  overdue: "Po splatnosti",
  paid: "Zaplaceno",
  cancelled: "Stornováno",
};
const stageLabels: Record<ReminderStage, string> = {
  before_due: "Upozornění před splatností",
  on_due: "Upomínka v den splatnosti",
  overdue: "Upomínka po splatnosti",
  escalation: "Eskalace pohledávky",
};
const activityLabels: Record<ActivityRecord["event_type"], string> = {
  created: "Faktura byla založena",
  updated: "Údaje faktury byly upraveny",
  paid: "Faktura byla plně uhrazena",
  reopened: "Faktura byla vrácena mezi neuhrazené",
  cancelled: "Faktura byla stornována",
  overdue: "Faktura přešla po splatnosti",
  reminders_paused: "Upomínky této faktury byly pozastaveny",
  reminders_resumed: "Upomínky této faktury byly znovu zapnuté",
  payment_changed: "Změnila se uhrazená částka",
};
const fieldLabels: Record<string, string> = {
  invoice_number: "číslo faktury",
  counterparty_name: "odběratel",
  counterparty_ico: "IČO",
  counterparty_dic: "DIČ",
  counterparty_email: "kontaktní e-mail",
  variable_symbol: "variabilní symbol",
  amount: "částka",
  currency: "měna",
  issue_date: "datum vystavení",
  due_date: "datum splatnosti",
  notes: "poznámka",
};

function reminderDescription(item: ReminderRecord) {
  if (item.status === "failed")
    return `Neúspěšné · pokus ${item.attempt_count}${item.error_message ? ` · ${item.error_message}` : ""}`;
  if (item.status === "skipped") return "Přeskočeno jako zastaralé";
  if (item.status === "queued") return "Čeká na odeslání";
  if (item.delivery_status === "delivered")
    return `Doručeno ${dateTime(item.delivered_at)} na ${item.sent_to}`;
  if (item.delivery_status === "bounced")
    return `Vráceno přijímajícím serverem${item.delivery_error ? ` · ${item.delivery_error}` : ""}`;
  if (item.delivery_status === "complained")
    return "Příjemce označil zprávu jako spam";
  if (item.delivery_status === "delayed")
    return `Doručení je odložené${item.delivery_error ? ` · ${item.delivery_error}` : ""}`;
  if (item.delivery_status === "failed")
    return `E-mailová služba zprávu nedoručila${item.delivery_error ? ` · ${item.delivery_error}` : ""}`;
  return `Předáno e-mailové službě ${dateTime(item.sent_at)} na ${item.sent_to}`;
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [emailSuppression, setEmailSuppression] =
    useState<EmailSuppression | null>(null);
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [payments, setPayments] = useState<BankPayment[]>([]);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updating, setUpdating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [paymentDate, setPaymentDate] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/invoices/${id}`).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        return d;
      }),
      fetch(`/api/invoices/${id}/reminders`).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        return d;
      }),
      fetch(`/api/invoices/${id}/activity`).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        return d;
      }),
    ])
      .then(([detail, history, events]) => {
        setInvoice(detail.invoice);
        setDocumentUrl(detail.document_url);
        setCanManage(Boolean(detail.can_manage));
        setPaymentDate(
          detail.invoice.paid_at?.slice(0, 10) ?? todayInTimeZone(),
        );
        setPayments(detail.payments ?? []);
        setReminders(history.reminders ?? []);
        setEmailSuppression(history.suppression ?? null);
        setActivity(events.events ?? []);
      })
      .catch((cause) =>
        setError(cause.message || "Fakturu se nepodařilo načíst."),
      )
      .finally(() => setLoading(false));
  }, [id]);

  async function patch(body: Record<string, unknown>) {
    const response = await fetch(`/api/invoices/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Fakturu se nepodařilo změnit.");
    setInvoice(data.invoice);
    const activityResponse = await fetch(`/api/invoices/${id}/activity`);
    if (activityResponse.ok)
      setActivity((await activityResponse.json()).events ?? []);
    return data as { invoice: Invoice; detached_payments?: number };
  }
  async function changeStatus(status: InvoiceStatus) {
    if (
      status === "pending" &&
      payments.length &&
      !await confirmAction({
        title: "Vrátit fakturu mezi neuhrazené?",
        description: "Spárovaná bankovní platba se bezpečně uvolní zpět ke kontrole.",
        confirmLabel: "Vrátit mezi neuhrazené",
      })
    )
      return;
    setUpdating(true);
    setError("");
    setNotice("");
    try {
      const result = await patch({ status });
      if (status === "pending") {
        setPayments([]);
        setNotice(
          result.detached_payments
            ? "Faktura je znovu neuhrazená a bankovní platba byla uvolněna ke kontrole."
            : "Faktura je znovu vedená jako neuhrazená.",
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Stav se nepodařilo změnit.",
      );
    } finally {
      setUpdating(false);
    }
  }
  async function recordPayment() {
    setUpdating(true);
    setError("");
    setNotice("");
    try {
      await patch({ status: "paid", paid_on: paymentDate });
      setRecordingPayment(false);
      setNotice(
        "Úhrada byla zapsána. Další automatické upomínky se zastavily.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Úhradu se nepodařilo zapsat.",
      );
    } finally {
      setUpdating(false);
    }
  }
  async function saveEdit(input: InvoiceInput) {
    await patch(input as unknown as Record<string, unknown>);
    const response = await fetch(`/api/invoices/${id}/reminders`);
    if (response.ok) {
      const history = await response.json();
      setReminders(history.reminders ?? []);
      setEmailSuppression(history.suppression ?? null);
    }
    setEditing(false);
  }
  async function setReminderPause(paused: boolean) {
    setUpdating(true);
    setError("");
    setNotice("");
    try {
      await patch({ reminders_paused: paused });
      setNotice(
        paused
          ? "Automatické upomínky jsou pozastavené pouze pro tuto fakturu."
          : "Automatické upomínky této faktury jsou znovu zapnuté.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Nastavení upomínek se nepodařilo změnit.",
      );
    } finally {
      setUpdating(false);
    }
  }
  async function retryReminder(reminderId: string) {
    setUpdating(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/invoices/${id}/reminders/${reminderId}/retry`,
        { method: "POST" },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Upomínku se nepodařilo znovu odeslat.");
      setReminders((current) =>
        current.map((item) =>
          item.id === reminderId ? { ...item, ...data.reminder } : item,
        ),
      );
      setInvoice((current) =>
        current ? { ...current, ...data.invoice } : current,
      );
      setNotice("Upomínka byla úspěšně odeslána a zapsána do historie.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Upomínku se nepodařilo znovu odeslat.",
      );
    } finally {
      setUpdating(false);
    }
  }
  async function unassignPayment(payment: BankPayment) {
    if (
      !await confirmAction({
        title: "Uvolnit tuto platbu z faktury?",
        description: "Zbývající částka a plán upomínek se automaticky přepočítají.",
        confirmLabel: "Uvolnit platbu",
      })
    )
      return;
    setUpdating(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/payments", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payment_id: payment.id }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Platbu se nepodařilo uvolnit.");
      const [detailResponse, activityResponse] = await Promise.all([
        fetch(`/api/invoices/${id}`),
        fetch(`/api/invoices/${id}/activity`),
      ]);
      if (detailResponse.ok) {
        const detail = await detailResponse.json();
        setInvoice(detail.invoice);
        setPayments(detail.payments ?? []);
      }
      if (activityResponse.ok)
        setActivity((await activityResponse.json()).events ?? []);
      setNotice(
        `Platba byla uvolněna. K úhradě zbývá ${money(Number(data.remaining), payment.currency)}.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Platbu se nepodařilo uvolnit.",
      );
    } finally {
      setUpdating(false);
    }
  }
  async function deleteInvoice() {
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/invoices/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Fakturu se nepodařilo smazat.");
      router.replace("/invoices");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Fakturu se nepodařilo smazat.");
      setDeleteConfirmOpen(false);
      setDeleting(false);
    }
  }

  if (loading)
    return (
      <AppFrame>
        <p className="page-state">Načítám detail faktury…</p>
      </AppFrame>
    );
  if (error && !invoice)
    return (
      <AppFrame>
        <p className="page-state error-state">{error}</p>
      </AppFrame>
    );
  if (!invoice) return null;
  const paidAmount = Number(invoice.paid_amount);
  const remainingAmount = Math.max(0, Number(invoice.amount) - paidAmount);
  const initial: InvoiceInput = {
    invoice_number: invoice.invoice_number,
    counterparty_name: invoice.counterparty_name,
    counterparty_ico: invoice.counterparty_ico ?? "",
    counterparty_dic: invoice.counterparty_dic ?? "",
    counterparty_email: invoice.counterparty_email,
    variable_symbol: invoice.variable_symbol ?? "",
    amount_without_vat: Number(invoice.amount_without_vat),
    vat_rate: Number(invoice.vat_rate),
    amount: Number(invoice.amount),
    currency: invoice.currency,
    issue_date: invoice.issue_date,
    due_date: invoice.due_date,
    notes: invoice.notes ?? "",
    source: invoice.source,
    file_url: invoice.file_url ?? undefined,
  };

  return (
    <AppFrame
      invoiceCount={
        invoice.status === "pending" || invoice.status === "overdue"
          ? 1
          : undefined
      }
    >
      <header className="section-header detail-page-header">
        <div>
          <Link href="/invoices" className="back-link">
            ← Zpět na faktury
          </Link>
          <p>DETAIL FAKTURY</p>
          <h1>{invoice.invoice_number}</h1>
          <span>{invoice.counterparty_name}</span>
        </div>
        {canManage && (
          <div className="section-actions">
            <button
              className="btn secondary"
              onClick={() => setEditing((value) => !value)}
            >
              {editing ? "Zavřít úpravy" : "Upravit údaje"}
            </button>
            {invoice.status === "paid" ? (
              <>
                <button
                  className="btn secondary"
                  disabled={updating}
                  onClick={() => setRecordingPayment((value) => !value)}
                >
                  Upravit datum úhrady
                </button>
                <button
                  className="btn secondary"
                  disabled={updating}
                  onClick={() => changeStatus("pending")}
                >
                  Vrátit mezi neuhrazené
                </button>
              </>
            ) : invoice.status === "pending" || invoice.status === "overdue" ? (
              <button
                className="btn primary"
                disabled={updating}
                onClick={() => {
                  setPaymentDate(todayInTimeZone());
                  setRecordingPayment(true);
                }}
              >
                Potvrdit úhradu
              </button>
            ) : null}
          </div>
        )}
      </header>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-success">{notice}</p>}
      {recordingPayment && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !updating) setRecordingPayment(false);
          }}
        >
          <section
            className="modal payment-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-confirm-title"
          >
            <header>
              <div>
                <small>MANUÁLNÍ ÚHRADA</small>
                <h2 id="payment-confirm-title">
                  {invoice.status === "paid"
                    ? "Upravit datum úhrady?"
                    : `Opravdu potvrdit úhradu faktury ${invoice.invoice_number}?`}
                </h2>
                <p>
                  {invoice.status === "paid"
                    ? "Změna se promítne do přehledů a reportů."
                    : "Faktura bude označena jako zaplacená a automatické upomínky se zastaví."}
                </p>
              </div>
              <button
                type="button"
                aria-label="Zavřít potvrzení úhrady"
                disabled={updating}
                onClick={() => setRecordingPayment(false)}
              >
                ×
              </button>
            </header>
            <div className="payment-confirm-content">
              <label>
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
                disabled={updating}
                onClick={() => setRecordingPayment(false)}
              >
                Zrušit
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={updating || !paymentDate}
                onClick={recordPayment}
              >
                {updating
                  ? "Ukládám…"
                  : invoice.status === "paid"
                    ? "Uložit datum"
                    : "Ano, potvrdit úhradu"}
              </button>
            </footer>
          </section>
        </div>
      )}
      {editing ? (
        <InvoiceForm
          key={invoice.updated_at}
          initial={initial}
          submitLabel="Uložit změny"
          onSubmit={saveEdit}
        />
      ) : (
        <>
          <section className={`invoice-hero ${invoice.status}`}>
            <div>
              <span>Částka faktury bez DPH</span>
              <strong>{money(Number(invoice.amount_without_vat), invoice.currency)}</strong>
              <p className="invoice-hero-gross">
                Částka s DPH: {money(Number(invoice.amount), invoice.currency)}
              </p>
              <small>
                {paidAmount > 0 && invoice.status !== "cancelled"
                  ? `Uhrazeno ${money(paidAmount, invoice.currency)} · zbývá ${money(remainingAmount, invoice.currency)}`
                  : `Variabilní symbol ${invoice.variable_symbol || "není uveden"}`}
              </small>
            </div>
            <span className={`status large ${invoice.status}`}>
              {statusLabels[invoice.status]}
            </span>
          </section>
          <div className="detail-page-grid">
            <div>
              <section className="page-panel info-section">
                <header>
                  <h2>Základní údaje</h2>
                </header>
                <div className="info-grid">
                  <div>
                    <span>Číslo faktury</span>
                    <strong>{invoice.invoice_number}</strong>
                  </div>
                  <div>
                    <span>Datum vystavení</span>
                    <strong>{date(invoice.issue_date)}</strong>
                  </div>
                  <div>
                    <span>Datum splatnosti</span>
                    <strong
                      className={invoice.status === "overdue" ? "red-text" : ""}
                    >
                      {date(invoice.due_date)}
                    </strong>
                  </div>
                  <div>
                    <span>Datum úplného zaplacení</span>
                    <strong>{date(invoice.paid_at)}</strong>
                  </div>
                  <div>
                    <span>Částka bez DPH</span>
                    <strong>{money(Number(invoice.amount_without_vat), invoice.currency)}</strong>
                  </div>
                  <div>
                    <span>Sazba DPH</span>
                    <strong>{Number(invoice.vat_rate).toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} %</strong>
                  </div>
                  <div>
                    <span>Částka s DPH</span>
                    <strong>{money(Number(invoice.amount), invoice.currency)}</strong>
                  </div>
                  <div>
                    <span>Uhrazená částka</span>
                    <strong>{money(paidAmount, invoice.currency)}</strong>
                  </div>
                  <div>
                    <span>Zbývá uhradit</span>
                    <strong className={remainingAmount > 0 ? "red-text" : ""}>
                      {money(remainingAmount, invoice.currency)}
                    </strong>
                  </div>
                  <div>
                    <span>Způsob zadání</span>
                    <strong>
                      {invoice.source === "ocr"
                        ? "Načteno z dokumentu (OCR)"
                        : "Ručně zadaná faktura"}
                    </strong>
                  </div>
                  <div>
                    <span>Další upomínka</span>
                    <strong>{dateTime(invoice.next_reminder_at)}</strong>
                  </div>
                  <div>
                    <span>Založeno</span>
                    <strong>{dateTime(invoice.created_at)}</strong>
                  </div>
                  <div>
                    <span>Poslední změna</span>
                    <strong>{dateTime(invoice.updated_at)}</strong>
                  </div>
                </div>
              </section>
              <section className="page-panel info-section">
                <header>
                  <h2>Odběratel a kontakt</h2>
                </header>
                <div className="info-grid">
                  <div>
                    <span>Název</span>
                    <strong>{invoice.counterparty_name}</strong>
                  </div>
                  <div>
                    <span>IČO / DIČ</span>
                    <strong>
                      {invoice.counterparty_ico || "—"} /{" "}
                      {invoice.counterparty_dic || "—"}
                    </strong>
                  </div>
                  <div className="wide">
                    <span>E-mail pro upomínky</span>
                    <strong>{invoice.counterparty_email}</strong>
                  </div>
                </div>
              </section>
              {payments.length > 0 && (
                <section className="page-panel info-section">
                  <header>
                    <h2>Spárované bankovní platby</h2>
                    <span>{payments.length} záznamů</span>
                  </header>
                  <div className="bank-payment-list">
                    {payments.map((payment) => (
                      <article key={payment.id}>
                        <div>
                          <strong>
                            {money(Number(payment.amount), payment.currency)}
                          </strong>
                          <span>
                            Připsáno {date(payment.booked_on)} · VS{" "}
                            {payment.variable_symbol || "—"}
                          </span>
                          <small>
                            {payment.counterparty_name ||
                              "Protistrana neuvedena"}
                            {payment.counterparty_account
                              ? ` · ${payment.counterparty_account}`
                              : ""}
                          </small>
                        </div>
                        <div>
                          <small>ID {payment.external_id}</small>
                          {canManage && (
                            <button
                              type="button"
                              className="btn secondary compact"
                              disabled={updating}
                              onClick={() => unassignPayment(payment)}
                            >
                              Uvolnit platbu
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}
              {invoice.notes && (
                <section className="page-panel info-section">
                  <header>
                    <h2>Interní poznámka</h2>
                  </header>
                  <p className="detail-notes">{invoice.notes}</p>
                </section>
              )}
              <MobileDisclosure label="Historie změn faktury" className="invoice-history-disclosure">
              <section className="page-panel info-section">
                <header>
                  <h2>Historie změn</h2>
                  <span>Posledních {activity.length} událostí</span>
                </header>
                <div className="activity-history">
                  {activity.length ? (
                    activity.map((item) => (
                      <article key={item.id}>
                        <i />
                        <div>
                          <strong>{activityLabels[item.event_type]}</strong>
                          {item.event_type === "updated" &&
                          item.details.fields?.length ? (
                            <span>
                              Změněno:{" "}
                              {item.details.fields
                                .map((field) => fieldLabels[field] ?? field)
                                .join(", ")}
                            </span>
                          ) : null}
                          {item.event_type === "paid" &&
                          item.details.paid_at ? (
                            <span>
                              Datum úhrady: {date(item.details.paid_at)}
                              {item.details.corrected ? " · opravený údaj" : ""}
                            </span>
                          ) : null}
                          {item.event_type === "reopened" &&
                          item.details.paid_at ? (
                            <span>
                              Původní datum úhrady: {date(item.details.paid_at)}
                              {item.details.detached_payments
                                ? ` · uvolněno plateb: ${item.details.detached_payments}`
                                : ""}
                            </span>
                          ) : null}
                          {item.event_type === "payment_changed" &&
                          typeof item.details.to === "number" ? (
                            <span>
                              Uhrazeno{" "}
                              {money(item.details.to, invoice.currency)} · zbývá{" "}
                              {money(
                                Number(item.details.remaining || 0),
                                invoice.currency,
                              )}
                            </span>
                          ) : null}
                          <small>
                            {dateTime(item.created_at)} ·{" "}
                            {item.actor_email ?? "Automat aplikace"}
                          </small>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="empty-box">
                      Historie zatím neobsahuje žádné změny.
                    </p>
                  )}
                </div>
              </section>
              </MobileDisclosure>
            </div>
            <aside>
              <section className="page-panel info-section">
                <header>
                  <h2>Automatické upomínky</h2>
                  <span>{invoice.reminders_sent} odesláno</span>
                </header>
                {emailSuppression && (
                  <div className="email-suppression">
                    <strong>
                      E-mailová adresa je pro další odesílání zablokovaná
                    </strong>
                    <small>
                      {emailSuppression.reason === "complained"
                        ? "Příjemce označil zprávu jako spam."
                        : "Přijímající server zprávu trvale odmítl."}{" "}
                      Upravte kontaktní e-mail odběratele; automat do té doby
                      nic dalšího neodešle.
                    </small>
                  </div>
                )}
                {(invoice.status === "pending" ||
                  invoice.status === "overdue") && (
                  <div
                    className={`invoice-reminder-control ${invoice.reminders_paused ? "paused" : "active"}`}
                  >
                    <div>
                      <strong>
                        {invoice.reminders_paused
                          ? "Pro tuto fakturu pozastaveno"
                          : emailSuppression
                            ? "Čeká na opravu e-mailové adresy"
                            : "Pro tuto fakturu zapnuto"}
                      </strong>
                      <small>
                        {invoice.reminders_paused
                          ? "Žádný automatický e-mail neodejde, dokud je znovu nezapnete."
                          : emailSuppression
                            ? "Naplánované kroky zůstanou zastavené, dokud nezměníte kontakt."
                            : `Další plánovaná akce: ${dateTime(invoice.next_reminder_at)}`}
                      </small>
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        className="btn secondary compact"
                        disabled={updating}
                        onClick={() =>
                          setReminderPause(!invoice.reminders_paused)
                        }
                      >
                        {invoice.reminders_paused
                          ? "Znovu zapnout"
                          : "Pozastavit"}
                      </button>
                    )}
                  </div>
                )}
                <div className="reminder-history">
                  {reminders.length ? (
                    reminders.map((item) => (
                      <div
                        key={item.id}
                        className={`${item.status}${item.delivery_status ? ` delivery-${item.delivery_status}` : ""}`}
                      >
                        <i />
                        <div>
                          <strong>{stageLabels[item.stage]}</strong>
                          <span>Plán: {date(item.scheduled_for)}</span>
                          <small>{reminderDescription(item)}</small>
                          {canManage &&
                            item.status === "failed" &&
                            !invoice.reminders_paused &&
                            !emailSuppression && (
                              <button
                                type="button"
                                className="retry-reminder"
                                disabled={updating}
                                onClick={() => retryReminder(item.id)}
                              >
                                {updating ? "Odesílám…" : "Odeslat znovu"}
                              </button>
                            )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="empty-box">
                      Zatím nebyla naplánována ani odeslána žádná upomínka.
                    </p>
                  )}
                </div>
              </section>
              <MobileDisclosure label="Přiložený dokument" className="invoice-document-disclosure">
              <section className="page-panel info-section">
                <header>
                  <h2>Dokument</h2>
                </header>
                {invoice.file_url ? (
                  <div className="document-card">
                    <strong>Originální dokument faktury</strong>
                    <span>Uložen v soukromém firemním úložišti.</span>
                    {documentUrl ? (
                      <a
                        href={documentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn secondary"
                      >
                        Otevřít dokument
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <p className="empty-box">
                    K této faktuře není přiložen dokument.
                  </p>
                )}
              </section>
              </MobileDisclosure>
              {canManage && (
                <button
                  type="button"
                  className="btn danger invoice-delete-button"
                  disabled={updating || deleting}
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  Smazat fakturu
                </button>
              )}
            </aside>
          </div>
        </>
      )}
      {deleteConfirmOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleting) setDeleteConfirmOpen(false);
          }}
        >
          <section
            className="modal delete-invoice-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-invoice-title"
          >
            <header>
              <div>
                <small>TRVALÉ SMAZÁNÍ</small>
                <h2 id="delete-invoice-title">Smazat fakturu {invoice.invoice_number}?</h2>
                <p>Tuto akci nebude možné vrátit zpět.</p>
              </div>
              <button
                type="button"
                aria-label="Zavřít potvrzení"
                disabled={deleting}
                onClick={() => setDeleteConfirmOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="delete-invoice-content">
              <p>
                Faktura, její historie, upomínky a přiložený dokument budou trvale odstraněny.
                Případné bankovní platby zůstanou zachované, ale od faktury se odpojí.
              </p>
            </div>
            <footer className="delete-invoice-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={deleting}
                onClick={() => setDeleteConfirmOpen(false)}
              >
                Zrušit
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={deleting}
                onClick={deleteInvoice}
              >
                {deleting ? "Mažu fakturu…" : "Ano, trvale smazat"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </AppFrame>
  );
}
