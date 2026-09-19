export type InvoiceStatus = "pending" | "paid" | "overdue" | "cancelled";
export type InvoiceSource = "manual" | "ocr" | "email" | "accounting_api";
export type ReminderStage = "before_due" | "on_due" | "overdue" | "escalation";

export interface Invoice {
  money_evidence?: InvoiceInput["money_evidence"] | null;
  id: string;
  organization_id: string;
  // Set by the remember_customer_from_invoice trigger whenever
  // counterparty_ico is a valid 8-digit IČO; null otherwise (no match, or
  // the IČO belongs to the organization itself). Selected via `*` today so
  // this was already coming back from the API -- just never typed.
  customer_id?: string | null;
  reminder_policy_id?: string | null;
  reminder_days_snapshot: number[];
  reminder_plan_effective_from: string | null;
  reminder_policy?: { name: string; archived_at?: string | null } | null;
  invoice_number: string;
  counterparty_name: string;
  counterparty_ico: string | null;
  counterparty_dic: string | null;
  counterparty_email: string;
  variable_symbol: string | null;
  amount_without_vat: number;
  vat_rate: number;
  amount: number;
  paid_amount: number;
  currency: string;
  issue_date: string;
  due_date: string;
  status: InvoiceStatus;
  source: InvoiceSource;
  file_url: string | null;
  notes: string | null;
  paid_at: string | null;
  reminders_sent: number;
  last_reminder_at: string | null;
  next_reminder_at: string | null;
  reminders_paused: boolean;
  reminders_paused_at: string | null;
  reminders_paused_by: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceInput {
  money_evidence?: {
    [key: string]: import("./database").Json | undefined;
    original_total: number;
    total_source: "read" | "derived" | "manual";
    adjustment: number;
    adjustment_reason: string;
    adjustment_confirmed: boolean;
    initial_paid: number;
    initial_paid_confirmed: boolean;
    multi_rate: boolean;
  };
  reminder_policy_id?: string;
  invoice_number: string;
  counterparty_name: string;
  counterparty_ico?: string;
  counterparty_dic?: string;
  counterparty_email: string;
  variable_symbol?: string;
  amount_without_vat: number;
  vat_rate: number;
  amount: number;
  currency: string;
  issue_date: string;
  due_date: string;
  notes?: string;
  source?: InvoiceSource;
  file_url?: string;
}

export interface DashboardSummary {
  totalOutstanding: number;
  overdueAmount: number;
  pendingCount: number;
  overdueCount: number;
  remindersSent: number;
  paidThisMonth: number;
}
