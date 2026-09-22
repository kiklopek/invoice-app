import { isIsoDate } from "./invoice-validation";

export type PaymentReconciliationQuery = { from: string; to: string };

export type PaymentReconciliationSummary = {
  totals: {
    imports: number;
    accepted: number;
    auto_matched: number;
    needs_review: number;
    unmatched_payments: number;
    unacknowledged_mismatch_imports: number;
  };
  monthly: { key: string; imports: number; accepted: number; auto_matched: number; needs_review: number }[];
  recent_imports: {
    id: string;
    filename: string;
    committed_at: string;
    accepted_count: number;
    ignored_count: number;
    error_count: number;
    auto_matched: number;
    needs_review: number;
  }[];
};

// Reuses the same from/to already validated for the invoice report (see
// parseReportQuery in report-query.ts) -- this section shares that one date
// range rather than introducing a second filter bar on the reports page.
export function parsePaymentReconciliationQuery(from: string, to: string): PaymentReconciliationQuery | null {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return null;
  return { from, to };
}
