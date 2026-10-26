import "server-only";
import type { RequestIdentity } from "./auth";
import type { InvoiceListQuery } from "./invoice-list-query";
import { invoiceListRpcParams } from "./invoice-list-rpc-params";
import { PageDataError } from "./dashboard-page-data";

const BATCH_SIZE = 500;
const failure = () =>
  new PageDataError(
    "Součet faktur se nepodařilo načíst. Zkuste to znovu.",
    500,
  );

/** Same authorized/filtering RPC as the list; no database changes or client-side page sums. */
export async function loadInvoiceListTotals(
  identity: RequestIdentity | null,
  query: InvoiceListQuery,
): Promise<Record<string, number>> {
  if (!identity) throw new PageDataError("Nejste přihlášený uživatel.", 401);
  const cents = new Map<string, bigint>();
  const seen = new Set<string>();
  let expected: number | undefined;
  for (let page = 1; ; page++) {
    const { data, error } = await identity.service.rpc(
      "list_invoices_page_filtered",
      invoiceListRpcParams(
        identity.membership.organization_id,
        identity.user.id,
        query,
        page,
        BATCH_SIZE,
      ),
    );
    const result = data as {
      total: number;
      invoices: Array<{ id: string; amount: number; currency: string }>;
    } | null;
    if (
      error ||
      !result ||
      !Number.isInteger(result.total) ||
      result.total < 0 ||
      !Array.isArray(result.invoices)
    )
      throw failure();
    expected ??= result.total;
    if (
      result.total !== expected ||
      result.invoices.length !==
        Math.min(BATCH_SIZE, Math.max(0, expected - (page - 1) * BATCH_SIZE))
    )
      throw failure();
    for (const invoice of result.invoices) {
      if (seen.has(invoice.id) || !Number.isFinite(Number(invoice.amount)))
        throw failure();
      seen.add(invoice.id);
      cents.set(
        invoice.currency,
        (cents.get(invoice.currency) ?? 0n) +
          BigInt(Math.round(Number(invoice.amount) * 100)),
      );
    }
    if (seen.size === expected) break;
  }
  return Object.fromEntries(
    [...cents].map(([currency, value]) => [currency, Number(value) / 100]),
  );
}
