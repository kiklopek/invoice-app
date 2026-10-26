"use client";

import { InvoiceDetailHeading, InvoiceDetailWorkspace } from "./invoice-detail-workspace";
import { issuedDocument } from "@/lib/invoice-creation";
import { ExactMoney } from "@/components/money-amount";
import styles from "./invoice-detail.module.css";

import { useSmallMobile } from "@/components/layout/mobile-header-slot";
import { Icon } from "@/components/icons";
import { CloseIcon } from "@/components/close-icon";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { AppFrame } from "@/components/layout/app-shell";
import { Modal } from "@/components/modal";
import { OptionalPaymentAssignment } from "@/components/optional-payment-assignment";
import { assignBankPaymentToInvoice } from "@/lib/assignable-bank-payment";
import { todayInTimeZone } from "@/lib/reminders";
import { confirmAction } from "@/lib/confirm-action";
import { useInvalidateWorkspaceData } from "@/lib/workspace-cache";
import type {
  Invoice,
  InvoiceInput,
  InvoiceStatus,
  ReminderStage,
} from "@/types/invoice";
import type { ActivityRecord, BankPayment, EmailSuppression, InvoiceDetailPageData, ReminderRecord } from "@/lib/invoice-detail-page-data";
import { useToast } from "@/components/toast";

// Formulář (včetně čtení faktur z PDF) se zobrazí jen při úpravě; stáhne se
// až tehdy, ne s každým otevřením detailu faktury.
const InvoiceForm = dynamic(() => import("@/components/invoice-form").then((mod) => mod.InvoiceForm), {
  loading: () => <p className="muted">Načítám formulář…</p>,
});

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
  emailed: "Faktura byla odeslána e-mailem",
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

export function InvoiceDetailClient({ id, initialData }: { id: string; initialData: InvoiceDetailPageData }) {
  const router = useRouter();
  const mobile = useSmallMobile();
  const { showToast } = useToast();
  const invalidateWorkspaceData = useInvalidateWorkspaceData();
  const [invoice, setInvoice] = useState<Invoice | null>(initialData.invoice);
  const [reminders, setReminders] = useState<ReminderRecord[]>(initialData.reminders);
  const [emailSuppression, setEmailSuppression] =
    useState<EmailSuppression | null>(initialData.suppression);
  const [activity, setActivity] = useState<ActivityRecord[]>(initialData.events);
  const [payments, setPayments] = useState<BankPayment[]>(initialData.payments);
  const [canManage, setCanManage] = useState(initialData.can_manage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updating, setUpdating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [paymentDate, setPaymentDate] = useState("");
  const [selectedBankPaymentId, setSelectedBankPaymentId] = useState("");
  const [confirmWithoutBankPayment, setConfirmWithoutBankPayment] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sendingInvoice, setSendingInvoice] = useState(false);
  const emailAction = useRef<{ key: string; busy: boolean } | null>(null);
  const actionsMenuRef = useRef<HTMLDetailsElement>(null);

  const { data: refreshedData, error: loadError, mutate: refreshDetail } = useSWR<InvoiceDetailPageData>(`/api/invoices/${id}/page-data`, {
    fallbackData: initialData,
    revalidateOnMount: false,
  });

  useEffect(() => {
    setPaymentDate(initialData.invoice.paid_at?.slice(0, 10) ?? todayInTimeZone());
  }, [initialData.invoice.paid_at]);

  useEffect(() => {
    if (!(loadError instanceof Error)) return;
    // Výpadek obnovovacího dotazu je přechodný stav, ne stav stránky.
    // Jako `setError` by zůstal viset jako trvalá hláška i poté, co se
    // připojení vrátilo.
    showToast({ variant: "error", message: loadError.message });
  }, [loadError, showToast]);

  useEffect(() => {
    if (!refreshedData) return;
    setInvoice(refreshedData.invoice);
    setCanManage(refreshedData.can_manage);
    setPayments(refreshedData.payments);
    setReminders(refreshedData.reminders);
    setEmailSuppression(refreshedData.suppression);
    setActivity(refreshedData.events);
    setLoading(false);
  }, [refreshedData]);

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
    void refreshDetail();
    // Dashboard, Reporty a další už navštívené stránky sdílejí jednu cache
    // a bez tohohle by po změně stavu/úhradě zůstaly na starých číslech --
    // fallbackData ze serveru se ignoruje, když cache pro klíč už něco má.
    void invalidateWorkspaceData();
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
    // Storno je účetně správná operace pro fakturu, která se nemá platit --
    // do teď v UI chybělo úplně, takže uživateli zbývalo jen nevratné
    // smazání vydané faktury. Ptáme se, protože stav uvidí i odběratel
    // a upomínky se tím zastaví.
    if (
      status === "cancelled" &&
      !await confirmAction({
        title: `Stornovat fakturu ${invoice?.invoice_number ?? ""}?`,
        description: "Faktura zůstane v archivu jako stornovaná a přestanou se k ní odesílat upomínky. Na rozdíl od smazání zůstane dohledatelná.",
        confirmLabel: "Stornovat fakturu",
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
      if (invoice?.status !== "paid" && selectedBankPaymentId) {
        const assignment = await assignBankPaymentToInvoice(selectedBankPaymentId, id);
        await refreshDetail();
        void invalidateWorkspaceData();
        setNotice(assignment.settlement === "partial"
          ? "Bankovní platba byla přiřazena jako částečná úhrada. Faktura zůstává otevřená."
          : "Bankovní platba byla přiřazena a faktura je uhrazená.");
      } else {
        if (invoice?.status !== "paid" && !confirmWithoutBankPayment) return;
        await patch({ status: "paid", paid_on: paymentDate });
        setNotice("Úhrada byla zapsána. Další automatické upomínky se zastavily.");
      }
      setRecordingPayment(false);
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
  async function sendInvoiceEmail() {
    if (emailAction.current?.busy) return;
    emailAction.current ??= { key: crypto.randomUUID(), busy: false };
    emailAction.current.busy = true;
    // Odchozí e-mail zákazníkovi je nevratný. Dřív stačilo jedno kliknutí
    // v rozbalovacím menu, hned vedle neškodných položek jako "Upravit údaje".
    if (!await confirmAction({
      title: "Odeslat fakturu e-mailem?",
      description: `Faktura ${invoice?.invoice_number ?? ""} se odešle na ${invoice?.counterparty_email ?? "e-mail odběratele"}. Odeslaný e-mail už nelze vzít zpět.`,
      confirmLabel: "Odeslat",
    })) { emailAction.current.busy = false; return; }
    setSendingInvoice(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/invoices/${id}/send`, { method: "POST", headers: { "x-idempotency-key": emailAction.current.key } });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Fakturu se nepodařilo odeslat e-mailem.");
      emailAction.current = null;
      setNotice("Faktura byla odeslána e-mailem.");
      void refreshDetail();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Fakturu se nepodařilo odeslat e-mailem.",
      );
    } finally {
      if (emailAction.current) emailAction.current.busy = false;
      setSendingInvoice(false);
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
      void refreshDetail();
      // Uvolnění mění zbývající zůstatek faktury -- stejný důvod jako u patch().
      void invalidateWorkspaceData();
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
      // Dashboard a Reporty jsou v tuhle chvíli typicky ještě nepřipojené --
      // invalidace jen zahodí jejich cache, takže příští návštěva natáhne
      // čerstvá data místo toho, co platilo před smazáním.
      void invalidateWorkspaceData();
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
  const initial: InvoiceInput = {
    money_evidence: invoice.money_evidence ?? undefined,
    reminder_policy_id: invoice.reminder_policy_id ?? undefined,
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

  function closeActionsMenu() {
    if (actionsMenuRef.current) actionsMenuRef.current.open = false;
  }

  return (
    <AppFrame className={`content section-page ${styles.page}`}>
      <InvoiceDetailHeading invoice={invoice} onBack={editing ? () => { setEditing(false); window.scrollTo({ top: 0, behavior: "instant" }); } : undefined} actions={
        <div className={`section-actions invoice-detail-actions ${styles.actions}`}>
          <details className="invoice-actions-menu" ref={actionsMenuRef}>
            <summary aria-label="Další akce s fakturou" title="Další akce">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </summary>
            <div className="invoice-actions-menu-popover" data-popup>
              <a
                href={`/api/invoices/${id}/pdf`}
                target="_blank"
                rel="noreferrer"
                onClick={closeActionsMenu}
              >
                Stáhnout PDF
              </a>
              {canManage && invoice.status === "paid" ? (
                <>
                  <button
                    type="button"
                    disabled={updating}
                    onClick={() => {
                      closeActionsMenu();
                      setRecordingPayment((value) => !value);
                    }}
                  >
                    Upravit datum úhrady
                  </button>
                  <button
                    type="button"
                    disabled={updating}
                    onClick={() => {
                      closeActionsMenu();
                      void changeStatus("pending");
                    }}
                  >
                    Vrátit mezi neuhrazené
                  </button>
                </>
              ) : null}
              {canManage ? (
                <>
                  {!issuedDocument(invoice) && <button
                    type="button"
                    onClick={() => {
                      closeActionsMenu();
                      setEditing((value) => !value);
                    }}
                  >
                    {editing ? "Zavřít úpravy" : "Upravit údaje"}
                  </button>}
                  <button
                    type="button"
                    disabled={sendingInvoice}
                    onClick={() => {
                      closeActionsMenu();
                      void sendInvoiceEmail();
                    }}
                  >
                    {sendingInvoice ? "Odesílám…" : "Odeslat fakturu e-mailem"}
                  </button>
                  {(invoice.status === "pending" || invoice.status === "overdue") ? (
                    <button
                      type="button"
                      disabled={updating}
                      onClick={() => {
                        closeActionsMenu();
                        void changeStatus("cancelled");
                      }}
                    >
                      Stornovat fakturu
                    </button>
                  ) : null}
                </>
              ) : null}
              {mobile && canManage && !issuedDocument(invoice) && <button type="button" className={styles.mobileMenuDelete} disabled={updating || deleting} onClick={() => { closeActionsMenu();setDeleteConfirmOpen(true); }}>Smazat fakturu</button>}
            </div>
          </details>
          {canManage && (
            <>
              {!issuedDocument(invoice) && <button
                type="button"
                className="btn danger invoice-delete-button"
                disabled={updating || deleting}
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" /></svg> Smazat fakturu
              </button>}
              {invoice.status === "pending" || invoice.status === "overdue" ? (
                <button
                  className="btn primary"
                  disabled={updating}
                  onClick={() => {
                    setPaymentDate(todayInTimeZone());
                    setSelectedBankPaymentId("");
                    setConfirmWithoutBankPayment(false);
                    setRecordingPayment(true);
                  }}
                >
                  <Icon name="payment-card" /> Potvrdit úhradu
                </button>
              ) : null}

            </>
          )}
          <div className={styles.mobileQuickActions}><a href={`/api/invoices/${id}/pdf`} target="_blank" rel="noreferrer"><Icon name="download"/><span>Stáhnout PDF</span></a>{canManage && <button type="button" disabled={sendingInvoice || updating} onClick={() => void sendInvoiceEmail()}><Icon name="mail"/><span>{sendingInvoice ? "Odesílám…" : "Odeslat fakturu"}</span></button>}</div>
        </div>
      } />
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="form-success">{notice}</p>}
      <Modal
        open={recordingPayment}
        onClose={() => setRecordingPayment(false)}
        closeDisabled={updating}
        labelledBy="payment-confirm-title"
        className="payment-confirm-modal"
      >
        <header>
          <div>
            <small>{invoice.status === "paid" ? "DATUM ÚHRADY" : "POTVRZENÍ ÚHRADY"}</small>
            <h2 id="payment-confirm-title">
              {invoice.status === "paid"
                ? "Upravit datum úhrady?"
                : `Opravdu potvrdit úhradu faktury ${invoice.invoice_number}?`}
            </h2>
            <p>
              {invoice.status === "paid"
                ? "Změna se promítne do přehledů a reportů."
                : selectedBankPaymentId
                  ? "Bankovní platba se přiřadí k faktuře. Upomínky se zastaví po úplné úhradě."
                  : "Faktura bude označena jako zaplacená a automatické upomínky se zastaví."}
            </p>
          </div>
          <button
            type="button"
            aria-label="Zavřít potvrzení úhrady"
            disabled={updating}
            onClick={() => setRecordingPayment(false)}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="payment-confirm-content">
          {invoice.status !== "paid" && <OptionalPaymentAssignment
            invoiceId={id}
            enabled={recordingPayment}
            selectedPaymentId={selectedBankPaymentId}
            confirmWithoutPayment={confirmWithoutBankPayment}
            onSelectPayment={setSelectedBankPaymentId}
            onConfirmWithoutPayment={setConfirmWithoutBankPayment}
          />}
          {(invoice.status === "paid" || !selectedBankPaymentId) && <label className={invoice.status !== "paid" ? "quick-payment-date" : undefined}>
            <span>Datum úhrady</span>
            <input
              type="date"
              value={paymentDate}
              max={todayInTimeZone()}
              onChange={(event) => setPaymentDate(event.target.value)}
            />
            <small>Zadejte skutečný den, kdy byla částka připsána.</small>
          </label>}
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
            disabled={updating || (invoice.status === "paid" ? !paymentDate : !selectedBankPaymentId && (!paymentDate || !confirmWithoutBankPayment))}
            onClick={recordPayment}
          >
            {updating
              ? "Ukládám…"
              : invoice.status === "paid"
                ? "Uložit datum"
                : selectedBankPaymentId
                  ? "Přiřadit a potvrdit"
                  : "Potvrdit bez platby"}
          </button>
        </footer>
      </Modal>
      {editing ? (
        <section className={styles.editor} aria-label="Úprava údajů faktury">
        <InvoiceForm
          editing
          key={invoice.updated_at}
          initial={initial}
          submitLabel="Uložit změny"
          onSubmit={saveEdit}
        />
        </section>
      ) : (
        <InvoiceDetailWorkspace invoice={invoice} payments={payments} canManage={canManage} updating={updating} suppression={emailSuppression}
          onPause={paused => void setReminderPause(paused)} onUnassign={payment => void unassignPayment(payment)}
          historyCount={activity.length} history={<>                <div className="activity-history">
                  {activity.length ? (
                    activity.map((item) => (
                      <article key={item.id} data-event={item.event_type}>
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
                          {item.event_type === "emailed" &&
                          item.details.sent_to ? (
                            <span>Příjemce: {item.details.sent_to}</span>
                          ) : null}
                          {item.event_type === "payment_changed" &&
                          typeof item.details.to === "number" ? (
                            <span>
                              Uhrazeno{" "}
                              <ExactMoney value={item.details.to} currency={invoice.currency} /> · zbývá{" "}
                              <ExactMoney value={Number(item.details.remaining || 0)} currency={invoice.currency} />
                            </span>
                          ) : null}
                          <small className={styles.activityMeta}>
                            <time dateTime={item.created_at}>{dateTime(item.created_at)}</time>
                            <span aria-hidden="true">·</span>
                            <span>{item.actor_email ?? "Automat aplikace"}</span>
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
</>} reminderHistory={<>                <div className="reminder-history">
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
                            (invoice.status === "pending" || invoice.status === "overdue") &&
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
</>} />
      )}
      <Modal
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        closeDisabled={deleting}
        labelledBy="delete-invoice-title"
        className="delete-invoice-modal"
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
            <CloseIcon />
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
      </Modal>
    </AppFrame>
  );
}
