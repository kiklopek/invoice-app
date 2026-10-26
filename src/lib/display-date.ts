/** Calendar dates are rendered at noon UTC so DST/time zones cannot shift a day. */
export function formatCzechDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague" }).format(date);
}
