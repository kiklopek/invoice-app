import "server-only";
import type { RequestIdentity } from "@/lib/auth";

export type InvoicePaymentHistoryEntry = {
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
  source: "bank_import" | "manual";
  match_status: "matched" | "split" | "unmatched" | "ambiguous";
  /** Why an unattended run booked this payment; null when a person confirmed it. */
  match_reason: string | null;
  allocation_amount: number;
};

// bank_payments.invoice_id only reflects the legacy 1:1 case -- a GPC payment
// split across several invoices leaves it null, so reading straight off that
// column silently hides split payments from an invoice's history. The
// allocations table is the source of truth for which payments settled which
// invoice, regardless of source (bank import, CSV, or manual confirmation).
export async function loadInvoicePaymentHistory(
  service: RequestIdentity["service"],
  organizationId: string,
  invoiceId: string,
): Promise<InvoicePaymentHistoryEntry[]> {
  const { data, error } = await service
    .from("bank_payment_allocations")
    .select(
      "amount, committed_at, bank_payment:bank_payments!bank_payment_allocations_payment_same_org(id, external_id, booked_on, amount, currency, variable_symbol, counterparty_name, counterparty_account, note, matched_at, source, match_status, match_reason)",
    )
    .eq("organization_id", organizationId)
    .eq("invoice_id", invoiceId)
    .eq("is_committed", true)
    .order("committed_at", { ascending: false });
  if (error) throw error;

  return (data ?? [])
    .filter((row): row is typeof row & { bank_payment: NonNullable<typeof row.bank_payment> } => Boolean(row.bank_payment))
    .map((row) => ({
      ...row.bank_payment,
      amount: Number(row.bank_payment.amount),
      source: row.bank_payment.source as "bank_import" | "manual",
      match_status: row.bank_payment.match_status as InvoicePaymentHistoryEntry["match_status"],
      allocation_amount: Number(row.amount),
    }));
}
