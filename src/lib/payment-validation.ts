import { isIsoDate } from "./invoice-validation";

export function parsePaymentDate(value: unknown, today: string) {
  if (typeof value !== "string" || !isIsoDate(value) || value > today) return null;
  return value;
}

// Poledne UTC drží kalendářní datum stabilní i při zobrazení v českém pásmu.
export function paymentDateToTimestamp(value: string) {
  return `${value}T12:00:00.000Z`;
}
