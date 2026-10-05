export type AssignableBankPayment = {
  id: string;
  booked_on: string;
  amount: number;
  currency: string;
  variable_symbol: string | null;
  counterparty_name: string | null;
  match_status: "unmatched" | "ambiguous";
  recommended: boolean;
  unavailable_reason: string | null;
};

export type AssignableBankPaymentsResponse = {
  payments: AssignableBankPayment[];
  remaining_amount: number;
};

export async function assignBankPaymentToInvoice(paymentId: string, invoiceId: string) {
  const response = await fetch("/api/payments", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payment_id: paymentId, invoice_id: invoiceId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Platbu se nepodařilo přiřadit.");
  return data as { invoice_status?: "pending" | "overdue" | "paid"; settlement?: string; paid_amount?: number; remaining?: number };
}
