import type { Invoice } from "@/types/invoice";

export const reminderTemplateVariables = [
  "invoice_number",
  "variable_symbol",
  "counterparty_name",
  "amount",
  "currency",
  "due_date",
] as const;

const allowedVariables = new Set<string>(reminderTemplateVariables);

export type ReminderTemplateValues = Record<(typeof reminderTemplateVariables)[number], string>;

export function unsupportedTemplateVariables(template: string) {
  const found = [...template.matchAll(/{{\s*(\w+)\s*}}/g)].map(match => match[1]);
  return [...new Set(found.filter(variable => !allowedVariables.has(variable)))];
}

export function interpolateReminderTemplate(template: string, invoice: Invoice) {
  const values: ReminderTemplateValues = {
    invoice_number: invoice.invoice_number,
    variable_symbol: invoice.variable_symbol ?? "",
    counterparty_name: invoice.counterparty_name,
    amount: new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(invoice.amount)),
    currency: invoice.currency,
    due_date: new Intl.DateTimeFormat("cs-CZ", { timeZone: "UTC" }).format(new Date(`${invoice.due_date}T00:00:00.000Z`)),
  };
  return interpolateReminderTemplateValues(template, values);
}

export function interpolateReminderTemplateValues(template: string, values: ReminderTemplateValues) {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, key: string) => values[key as keyof ReminderTemplateValues] ?? "");
}
