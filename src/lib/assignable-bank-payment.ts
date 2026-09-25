export type AssignableBankPayment = {
  id: string;
  booked_on: string;
  amount: number;
  currency: string;
  variable_symbol: string | null;
  counterparty_name: string | null;
  match_status: "unmatched" | "ambiguous";
};

export type AssignableBankPaymentsResponse = {
  payments: AssignableBankPayment[];
};

export async function assignBankPaymentToInvoice(paymentId: string, invoiceId: string) {
  const response = await fetch("/api/payments", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payment_id: paymentId, invoice_id: invoiceId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Platbu se nepodařilo přiřadit.");
  return data as { invoice_status?: string; settlement?: string };
}
