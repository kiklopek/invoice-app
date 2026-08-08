export type InvoiceStatus = "pending" | "paid" | "overdue" | "cancelled";
export type InvoiceSource = "manual" | "ocr" | "email" | "accounting_api";
export type ReminderStage = "before_due" | "on_due" | "overdue" | "escalation";

export interface Invoice {
  id: string;
  organization_id: string;
  reminder_policy_id?: string | null;
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
