"use client";

import useSWR from "swr";
import type { AssignableBankPaymentsResponse } from "@/lib/assignable-bank-payment";

const money = (value: number, currency: string) =>
  new Intl.NumberFormat("cs-CZ", { style: "currency", currency }).format(value);
const shortDate = (value: string) =>
  new Intl.DateTimeFormat("cs-CZ").format(new Date(`${value}T12:00:00`));

export function OptionalPaymentAssignment({
  invoiceId,
  enabled,
  selectedPaymentId,
  confirmWithoutPayment,
  onSelectPayment,
  onConfirmWithoutPayment,
}: {
  invoiceId: string;
  enabled: boolean;
  selectedPaymentId: string;
  confirmWithoutPayment: boolean;
  onSelectPayment: (paymentId: string) => void;
  onConfirmWithoutPayment: (confirmed: boolean) => void;
}) {
  const { data, error, isLoading } = useSWR<AssignableBankPaymentsResponse>(
    enabled ? `/api/invoices/${invoiceId}/assignable-payments` : null,
    async (url: string) => {
      const response = await fetch(url);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Platby se nepodařilo načíst.");
      return payload;
    },
    { revalidateOnFocus: false },
  );
  const payments = data?.payments ?? [];
  const recommended = payments.filter((payment) => payment.recommended);
  const otherPayments = payments.filter((payment) => !payment.recommended);
  const selected = payments.find((payment) => payment.id === selectedPaymentId);

  return <section className="payment-assignment-choice" aria-labelledby="payment-assignment-title">
    <div className="payment-assignment-heading">
      <div><strong id="payment-assignment-title">Přiřadit bankovní platbu</strong><small>Volitelné</small></div>
      <p>Vyberte odpovídající nespárovanou platbu, pokud už je ve výpisu.</p>
    </div>
    <label>
      <span>Bankovní platba</span>
      <select
        value={selectedPaymentId}
        disabled={isLoading || Boolean(error)}
        onChange={(event) => {
          onSelectPayment(event.target.value);
          if (event.target.value) onConfirmWithoutPayment(false);
        }}
      >
        <option value="">{isLoading ? "Načítám nepřiřazené platby…" : payments.length ? "Bez přiřazení platby" : "Žádná nepřiřazená platba"}</option>
        {[{ label: "Doporučené platby", payments: recommended }, { label: "Ostatní nepřiřazené platby", payments: otherPayments }].map((group) => group.payments.length ? (
          <optgroup key={group.label} label={group.label}>
            {group.payments.map((payment) => <option key={payment.id} value={payment.id} disabled={Boolean(payment.unavailable_reason)}>
              {shortDate(payment.booked_on)} · {money(payment.amount, payment.currency)} · {payment.counterparty_name || "Neznámý plátce"}{payment.variable_symbol ? ` · VS ${payment.variable_symbol}` : ""}{payment.unavailable_reason ? ` — ${payment.unavailable_reason}` : ""}
            </option>)}
          </optgroup>
        ) : null)}
      </select>
      {error ? <small className="payment-assignment-error" role="alert">Nepřiřazené platby se nepodařilo načíst. Úhradu můžete potvrdit bez přiřazení.</small> : null}
      {selected ? <small>Datum úhrady se převezme z banky: {shortDate(selected.booked_on)}.</small> : null}
      {selected && data && selected.amount < data.remaining_amount ? <small>Platba pokryje část úhrady. Zbývá doplatit {money(data.remaining_amount - selected.amount, selected.currency)}.</small> : null}
    </label>
    {!selectedPaymentId ? <label className="payment-without-assignment-confirm">
      <input type="checkbox" checked={confirmWithoutPayment} onChange={(event) => onConfirmWithoutPayment(event.target.checked)}/>
      <span>Potvrdit úhradu bez přiřazení bankovní platby</span>
    </label> : null}
  </section>;
}
