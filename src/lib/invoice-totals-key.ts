/** Totals depend on filters, never on the selected page, page size, or visual sort. */
export function invoiceTotalsKey(listKey: string) {
  const params = new URLSearchParams(listKey.split("?")[1] ?? "");
  for (const key of ["page", "page_size", "paged", "format"])
    params.delete(key);
  const query = params.toString();
  return `/api/invoices/totals${query ? `?${query}` : ""}`;
}
