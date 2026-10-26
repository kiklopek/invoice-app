export type Invoice = {
  id: string;
  invoice_number: string;
  counterparty_name: string;
  amount: number;
  paid_amount: number;
  currency: string;
  variable_symbol: string | null;
  due_date?: string | null;
  counterparty_ico?: string | null;
};
export type PreviewEntry = {
  overlap_warning?: boolean;
  overlap_acknowledged_by?: string | null;
  bank_payment_id?: string | null;
  processing_error?: string | null;
  line_number: number;
  fingerprint: string;
  disposition: "accepted" | "ignored" | "error" | "duplicate";
  reason: string | null;
  amount: number | null;
  currency: string | null;
  booked_on: string | null;
  variable_symbol: string | null;
  counterparty_name: string | null;
  counterparty_account: string | null;
  counterparty_account_verified: boolean;
  proposal_kind:
    | "exact"
    | "combination"
    | "account_suggestion"
    | "ambiguous"
    | "manual"
    | null;
  proposal_confidence: "safe" | "review" | null;
  proposal_reason: string | null;
  proposed_invoice_ids: string[];
  /** Set when a reviewer marked the row "Nesouvisí s fakturami". */
  unrelated_at?: string | null;
};
export type PersistedPreviewEntry = PreviewEntry & { id: string };
export type PreviewDetail = {
  progress: { booked: number; errors: number; remaining: number };
  /** Payment id -> why an unattended run booked it. Empty for human decisions. */
  match_reasons: Record<string, string>;
  /** Entry id -> why the row looks like a transfer between own accounts. */
  own_transfers?: Record<string, string>;
  import: Preview["import"];
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
export type Preview = {
  progress?: PreviewDetail["progress"];
  import: { id: string; revision: number; duplicate: boolean; status: string };
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
export type ArchiveItem = {
  id: string;
  original_filename: string;
  status: string;
  entry_count: number;
  accepted_count: number;
  ignored_count: number;
  error_count: number;
  created_at: string;
  committed_at: string | null;
};
