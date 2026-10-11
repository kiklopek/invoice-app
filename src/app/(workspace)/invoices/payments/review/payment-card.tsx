"use client";

import type { ReactNode } from "react";
import type { PaymentReview } from "@/lib/payment-review-model";
import { REVIEW_COPY, STATUS_LABELS } from "@/lib/payment-review-copy";
import { reconciliationError } from "@/lib/reconciliation-errors";
import { formatDate, formatMoney, type Invoice, type PreviewEntry } from "./types";

export type PaymentCardActions = {
  accept: () => void;
  openPicker: () => void;
  setUnrelated: (next: boolean) => void;
  leaveUnmatched: () => void;
  acceptPartial: () => void;
  acceptOverpayment: () => void;
  overlapDifferent: () => void;
  overlapSame: () => void;
  release: () => void;
};

/**
 * Jedna platba z výpisu. Tři zóny: kdo a kolik platil │ co jsme našli │ co
 * s tím. Rozložení řídí šířka karty (container query), ne okno -- karta
 * vedle otevřeného výběru faktury je jinak široká než samotná.
 */
export function PaymentCard({
  entry,
  review,
  invoiceById,
  selectedIds,
  editable,
  canRelease,
  working,
  pickerOpen,
  actions,
  picker,
}: {
  entry: PreviewEntry;
  review: PaymentReview;
  invoiceById: Map<string, Invoice>;
  selectedIds: string[];
  /** Uživatel smí platbu měnit (role, import není uzavřený, řádek je otevřený). */
  editable: boolean;
  canRelease: boolean;
  working: boolean;
  pickerOpen: boolean;
  actions: PaymentCardActions;
  picker: ReactNode;
}) {
  const currency = entry.currency || "CZK";
  const amount = entry.amount == null ? null : Number(entry.amount);
  const shownIds = review.status === "suggested" ? review.suggestionIds : selectedIds;
  const shown = shownIds.map((id) => invoiceById.get(id)).filter((invoice): invoice is Invoice => Boolean(invoice));
  const gap = formatMoney(Math.abs(review.difference), currency);
  const payer = entry.counterparty_name?.trim() || "Plátce neuveden";
  const date = formatDate(entry.booked_on);
  const titleId = `payment-${entry.fingerprint}`;

  const buttons: ReactNode[] = [];
  const button = (key: string, label: string, onClick: () => void, variant: "primary" | "secondary" = "secondary", extra = "") =>
    buttons.push(
      <button key={key} type="button" className={`btn ${variant} payment-action ${extra}`.trim()} disabled={working} onClick={onClick}>
        {label}
      </button>,
    );
  let question: ReactNode = null;

  if (review.status === "booked") {
    if (canRelease) {
      buttons.push(
        <button key="release" type="button" className="btn secondary payment-action gpc-release-button" aria-label={REVIEW_COPY.unbookLabel} disabled={working} onClick={actions.release}>
          {REVIEW_COPY.unbook}
        </button>,
      );
    }
  } else if (editable) {
    switch (review.status) {
      case "suggested":
        button("accept", review.suggestionIds.length > 1 ? REVIEW_COPY.acceptMany : REVIEW_COPY.acceptOne, actions.accept, "primary", "gpc-proposal-button");
        button("other", REVIEW_COPY.chooseOther, actions.openPicker);
        button("unrelated", REVIEW_COPY.notInvoice, () => actions.setUnrelated(true), "secondary", "gpc-unrelated-button");
        break;
      case "no_match":
        if (!pickerOpen) button("pick", REVIEW_COPY.chooseInvoice, actions.openPicker, "primary");
        button("leave", REVIEW_COPY.leaveUnmatched, actions.leaveUnmatched);
        button("unrelated", REVIEW_COPY.notInvoice, () => actions.setUnrelated(true), "secondary", "gpc-unrelated-button");
        break;
      case "underpaid":
        question = (
          <div className="payment-question" role="group" aria-label="Částečná úhrada">
            <p>Platba je o <span className="money">{gap}</span> menší než faktura. Zaplatil odběratel jen část?</p>
            <div className="payment-question-actions">
              <button type="button" className="btn primary payment-action" disabled={working} onClick={actions.acceptPartial}>Ano, je to částečná úhrada</button>
              <button type="button" className="btn secondary payment-action" disabled={working} onClick={actions.openPicker}>Ne, vybrat jinou fakturu</button>
            </div>
          </div>
        );
        button("unrelated", REVIEW_COPY.notInvoice, () => actions.setUnrelated(true), "secondary", "gpc-unrelated-button");
        break;
      case "overpaid":
        question = (
          <div className="payment-question" role="group" aria-label="Přeplatek">
            <p>
              Platba je o <span className="money">{gap}</span> vyšší než {selectedIds.length === 1 ? "faktura" : "vybrané faktury"}.
              {selectedIds.length === 1 ? " Zaplatil odběratel víc?" : " Přidejte další fakturu nebo upravte částky."}
            </p>
            <div className="payment-question-actions">
              {selectedIds.length === 1 && (
                <button type="button" className="btn primary payment-action" disabled={working} onClick={actions.acceptOverpayment}>Ano, zbytek nechat nepřiřazený</button>
              )}
              <button type="button" className="btn secondary payment-action" disabled={working} onClick={actions.openPicker}>Vybrat další fakturu</button>
            </div>
          </div>
        );
        button("unrelated", REVIEW_COPY.notInvoice, () => actions.setUnrelated(true), "secondary", "gpc-unrelated-button");
        break;
      case "over_allocated":
        question = (
          <div className="payment-question" role="group" aria-label="Vybráno víc než platba">
            <p>Vybrané faktury dohromady převyšují platbu o <span className="money">{gap}</span>. Odeberte fakturu nebo upravte částky.</p>
            <div className="payment-question-actions">
              <button type="button" className="btn primary payment-action" disabled={working} onClick={actions.openPicker}>Upravit výběr</button>
            </div>
          </div>
        );
        break;
      case "possible_duplicate":
        question = (
          <div className="payment-question" role="group" aria-label="Možná duplicita">
            <p>Je to jiná platba, nebo ta samá z jiného výpisu? Podívejte se do původního výpisu v bance.</p>
            <div className="payment-question-actions">
              <button type="button" className="btn primary payment-action" disabled={working} onClick={actions.overlapDifferent}>Je to jiná platba</button>
              <button type="button" className="btn secondary payment-action" disabled={working} onClick={actions.overlapSame}>Je to stejná – přeskočit</button>
            </div>
          </div>
        );
        break;
      case "ready":
      case "ready_partial":
      case "ready_overpaid":
        button("other", REVIEW_COPY.chooseOther, actions.openPicker);
        button("unrelated", REVIEW_COPY.notInvoice, () => actions.setUnrelated(true), "secondary", "gpc-unrelated-button");
        break;
      case "left_unmatched":
        button("pick", REVIEW_COPY.chooseInvoice, actions.openPicker);
        button("unrelated", REVIEW_COPY.notInvoice, () => actions.setUnrelated(true), "secondary", "gpc-unrelated-button");
        break;
      case "unrelated":
      case "own_transfer":
        button("back", REVIEW_COPY.backToPayments, () => actions.setUnrelated(false), "secondary", "gpc-unrelated-button");
        break;
    }
  }

  return (
    <article className={`gpc-entry payment-card is-${review.bucket} status-${review.status}`} aria-labelledby={titleId}>
      <div className={`payment-card-body${buttons.length ? "" : " no-actions"}`}>
        <section className="payment-card-payment" data-zone="payment">
          <h3 id={titleId} className="payment-card-payer" title={payer}>{payer}</h3>
          <p className={`payment-card-amount${amount != null && amount < 0 ? " is-outgoing" : ""}`}>
            {amount == null ? "Částka chybí" : <span className="money">{formatMoney(amount, currency)}</span>}
          </p>
          <p className="payment-card-meta">
            {date && <span>{date}</span>}
            <span>{REVIEW_COPY.variableSymbolShort} <span className="symbol">{entry.variable_symbol || "—"}</span></span>
          </p>
        </section>
        <section className="payment-card-found" data-zone="found" aria-label={REVIEW_COPY.found}>
          <p className="payment-card-status"><span className="payment-card-status-pill">{STATUS_LABELS[review.status]}</span></p>
          <p className="payment-card-reason">{review.plainReason}</p>
          {shown.length > 0 && (
            <ul className="payment-card-invoices">
              {shown.map((invoice) => (
                <li key={invoice.id}>
                  <strong>Faktura {invoice.invoice_number}</strong>
                  <span className="payment-card-customer" title={invoice.counterparty_name}>{invoice.counterparty_name}</span>
                  <span className="payment-card-remaining">
                    {review.status === "booked" ? "celkem" : "zbývá"}{" "}
                    <span className="money">
                      {formatMoney(review.status === "booked" ? Number(invoice.amount) : Math.max(0, Number(invoice.amount) - Number(invoice.paid_amount)), invoice.currency)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {entry.processing_error && <p className="payment-card-error" role="alert">{reconciliationError(entry.processing_error).error}</p>}
          {question}
        </section>
        {buttons.length > 0 && (
          <div className="payment-card-actions" data-zone="actions">
            {buttons}
          </div>
        )}
        {pickerOpen && picker}
        <details className="payment-card-details">
          <summary>{REVIEW_COPY.details}</summary>
          <dl>
            <div><dt>Účet plátce</dt><dd className="account">{entry.counterparty_account || "neuveden"}</dd></div>
            {entry.counterparty_account && !entry.counterparty_account_verified && (
              <div><dt>Pozor</dt><dd>Číslo účtu plátce nemá platnou kontrolní číslici – ověřte ho ručně.</dd></div>
            )}
            <div><dt>{REVIEW_COPY.variableSymbol[0].toUpperCase() + REVIEW_COPY.variableSymbol.slice(1)}</dt><dd>{entry.variable_symbol || "neuveden"}</dd></div>
            <div><dt>Řádek ve výpisu</dt><dd>{entry.line_number}</dd></div>
            {entry.reason && <div><dt>Poznámka</dt><dd>{entry.reason}</dd></div>}
          </dl>
        </details>
      </div>
    </article>
  );
}
