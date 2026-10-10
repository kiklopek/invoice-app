// Číslo faktury při párování plateb. Firmy číslují různě („2026001“,
// „FV-2026/001“); plátce oddělovače často vynechá nebo změní. Stejná pravidla
// opakuje databáze (private.compact_invoice_number / numeric_invoice_number).

/** Číslo faktury jako VS: jen číslice, oddělovače (- / . mezera) vypuštěné. */
export function numericInvoiceNumber(invoiceNumber: string) {
  const trimmed = invoiceNumber.trim();
  return /^\d+([-/. ]\d+)*$/.test(trimmed) ? trimmed.replace(/\D/g, "") : "";
}

/** Číslo faktury bez oddělovačů (FV-2026/001 → FV2026001) pro porovnání. */
export function compactInvoiceNumber(value: string) {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "");
}
