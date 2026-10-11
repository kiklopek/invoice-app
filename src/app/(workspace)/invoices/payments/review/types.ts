// Tvary odpovědí API importu výpisu, sdílené panelem a jeho částmi.
import type { ReviewEntry, ReviewInvoice } from "@/lib/payment-review-model";

export type Invoice = ReviewInvoice;

export type PreviewEntry = ReviewEntry & {
  line_number: number;
  fingerprint: string;
  booked_on: string | null;
  counterparty_account: string | null;
  counterparty_account_verified: boolean;
  proposal_kind: "exact" | "combination" | "account_suggestion" | "ambiguous" | "manual" | null;
  /** Set when a reviewer marked the row "Nesouvisí s fakturami". */
  unrelated_at?: string | null;
};

export type PersistedPreviewEntry = PreviewEntry & { id: string };

export type Preview = {
  progress?: PreviewDetail["progress"];
  import: { id: string; revision: number; duplicate: boolean; status: string; original_filename?: string };
  account_mismatch: boolean;
  statement_account: string | null;
  expected_account: string | null;
  statement_bank?: { code: string | null; name: string | null; verified: boolean } | null;
  totals: { accepted: number; ignored: number; errors: number };
  entries: PreviewEntry[];
  proposal_invoices: Invoice[];
  total_entries: number;
  request_id: string;
};

export type PreviewDetail = {
  progress: { booked: number; errors: number; remaining: number };
  /** Payment id -> why an unattended run booked it. Empty for human decisions. */
  match_reasons: Record<string, string>;
  /** Entry id -> why the row looks like a transfer between own accounts. */
  own_transfers?: Record<string, string>;
  import: Preview["import"] & { account_mismatch?: boolean; statement_account?: string | null };
  expected_account?: string | null;
  totals: Preview["totals"];
  total_entries: number;
  entries: PersistedPreviewEntry[];
  allocations: Array<{
    statement_entry_id: string | null;
    invoice_id: string;
    amount: number;
    is_manual_partial: boolean;
    is_committed: boolean;
  }>;
  proposal_invoices: Invoice[];
  total: number;
};

export const formatMoney = (value: number, currency: string) =>
  new Intl.NumberFormat("cs-CZ", { style: "currency", currency }).format(value);

export const formatDate = (value: string | null) => {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
};
