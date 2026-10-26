import "server-only";
import type { RequestIdentity } from "./auth";
import { canAccessOperations, canViewFinancialInsights } from "./role-access";
import { PageDataError } from "./dashboard-page-data";
import { parseInvoiceListQuery } from "./invoice-list-query";
import { loadInvoiceListPageData } from "./invoice-list-page-data";
import { searchCustomers } from "./customer-search-data";
import { normalizeSearchText } from "./text-search";
import { isIsoDate } from "./invoice-validation";
import {
  parseSearchAmount,
  paymentSearchFilter,
  type WorkspaceSearchData,
  type WorkspaceSearchResult,
  type SearchResultType,
} from "./workspace-search";

const money = (value: number, currency: string) =>
  new Intl.NumberFormat("cs-CZ", { style: "currency", currency }).format(value);
const date = (value: string) =>
  new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague" }).format(
    new Date(`${value}T12:00:00Z`),
  );

export async function loadWorkspaceSearch(
  identity: RequestIdentity | null,
  query: string,
): Promise<WorkspaceSearchData> {
  if (!identity) throw new PageDataError("Nejste přihlášený uživatel.", 401);
  if (!canViewFinancialInsights(identity.membership.role))
    throw new PageDataError("K vyhledávání nemáte přístup.", 403);
  if (normalizeSearchText(query).length === 0)
    return { results: [], unavailable: [] };
  const amount = parseSearchAmount(query);
  const invoiceSearch = async (): Promise<WorkspaceSearchResult[]> => {
    const params = [new URLSearchParams({ q: query })];
    if (amount)
      params.push(
        new URLSearchParams({
          amount_min: String(amount.amount),
          amount_max: String(amount.amount),
          ...(amount.currency ? { currency: amount.currency } : {}),
        }),
      );
    const pages = await Promise.all(
      params.map((params) =>
        loadInvoiceListPageData(identity, parseInvoiceListQuery(params)!),
      ),
    );
    const seen = new Set<string>();
    return pages
      .flatMap((page) => page.invoices)
      .filter((invoice) => {
        if (seen.has(invoice.id)) return false;
        seen.add(invoice.id);
        return true;
      })
      .map((invoice) => ({
        id: invoice.id,
        type: "invoice",
        title: `Faktura ${invoice.invoice_number}`,
        subtitle: `${invoice.counterparty_name} · ${money(Number(invoice.amount), invoice.currency)}`,
        href: `/invoices/${encodeURIComponent(invoice.id)}`,
      }));
  };
  const customerSearch = async (): Promise<WorkspaceSearchResult[]> =>
    (await searchCustomers(identity, query)).map((customer) => ({
      id: customer.id,
      type: "customer",
      title: customer.name,
      subtitle:
        [customer.ico ? `IČO ${customer.ico}` : null, customer.email]
          .filter(Boolean)
          .join(" · ") || "Klient",
      href: `/customers?highlight=${encodeURIComponent(customer.id)}`,
    }));
  const paymentSearch = async (): Promise<WorkspaceSearchResult[]> => {
    const base = () =>
      identity.service
        .from("bank_payments")
        .select(
          "id,counterparty_name,variable_symbol,booked_on,amount,currency",
        )
        .eq("organization_id", identity.membership.organization_id);
    let text = base();
    // Each word may match a different field; filter BEFORE limiting to suggestions.
    for (const term of query.trim().split(/\s+/))
      text = text.or(paymentSearchFilter(term));
    if (isIsoDate(query)) text = base().eq("booked_on", query);
    const queries = [
      text.order("booked_on", { ascending: false }).order("id").limit(4),
    ];
    if (amount) {
      let numeric = base().eq("amount", amount.amount);
      if (amount.currency) numeric = numeric.eq("currency", amount.currency);
      queries.push(
        numeric.order("booked_on", { ascending: false }).order("id").limit(4),
      );
    }
    const pages = await Promise.all(queries);
    if (pages.some((page) => page.error))
      throw new PageDataError("Platby se nepodařilo vyhledat.", 500);
    const seen = new Set<string>();
    return pages
      .flatMap((page) => page.data ?? [])
      .filter((payment) => {
        if (seen.has(payment.id)) return false;
        seen.add(payment.id);
        return true;
      })
      .map((payment) => ({
        id: payment.id,
        type: "payment",
        title:
          payment.counterparty_name ||
          (payment.variable_symbol
            ? `Platba VS ${payment.variable_symbol}`
            : "Bankovní platba"),
        subtitle: `${date(payment.booked_on)} · ${money(Number(payment.amount), payment.currency)}${payment.variable_symbol ? ` · VS ${payment.variable_symbol}` : ""}`,
        href: `/invoices/payments/archive?highlight=${encodeURIComponent(payment.id)}#payment-${encodeURIComponent(payment.id)}`,
      }));
  };
  const searches: Array<{
    type: SearchResultType;
    run: () => Promise<WorkspaceSearchResult[]>;
  }> = [
    { type: "invoice", run: invoiceSearch },
    { type: "customer", run: customerSearch },
    ...(canAccessOperations(identity.membership.role)
      ? [{ type: "payment" as const, run: paymentSearch }]
      : []),
  ];
  const outcomes = await Promise.allSettled(
    searches.map((search) => search.run()),
  );
  const groups: WorkspaceSearchResult[][] = [],
    unavailable: SearchResultType[] = [];
  const normalized = normalizeSearchText(query);
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      unavailable.push(searches[index].type);
      return;
    }
    const rank = (result: WorkspaceSearchResult) =>
      normalizeSearchText(result.title) === normalized
        ? 0
        : normalizeSearchText(result.title).startsWith(normalized)
          ? 1
          : 2;
    groups.push(outcome.value.sort((a, b) => rank(a) - rank(b)).slice(0, 4));
  });
  if (unavailable.length === searches.length)
    throw new PageDataError(
      "Vyhledávání se nepodařilo načíst. Zkuste to znovu.",
      503,
    );
  const results = Array.from({ length: 4 }, (_, index) =>
    groups.flatMap((group) => (group[index] ? [group[index]] : [])),
  ).flat();
  return { results, unavailable };
}
