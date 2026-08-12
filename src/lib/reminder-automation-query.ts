export const REMINDER_POLICY_RELATION = "reminder_policies!invoices_policy_same_org_fkey";

export const INVOICE_REMINDER_POLICY_SELECT =
  `*, reminder_policy:${REMINDER_POLICY_RELATION}(days_from_due, is_active)`;

export const INVOICE_REMINDER_POLICY_STATE_SELECT =
  `*, reminder_policy:${REMINDER_POLICY_RELATION}(is_active)`;

export type InvoiceReminderPolicy = {
  reminder_policy?: { days_from_due: number[]; is_active: boolean } | null;
};

type DatabaseErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export function reminderDatabaseError(context: string, error: DatabaseErrorLike | null | undefined) {
  const code = error?.code?.trim() || "DATABASE_ERROR";
  const message = error?.message?.trim() || "Neznámá databázová chyba.";
  const details = error?.details?.trim();
  const hint = error?.hint?.trim();
  return [
    `${context} [${code}]: ${message}`,
    details ? `Detail: ${details}` : null,
    hint ? `Nápověda: ${hint}` : null,
  ].filter(Boolean).join(" ").slice(0, 1000);
}
