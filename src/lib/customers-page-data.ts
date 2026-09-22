import "server-only";

import type { RequestIdentity } from "@/lib/auth";
import { canManageInvoices, canViewFinancialInsights } from "@/lib/role-access";
import { PageDataError } from "@/lib/dashboard-page-data";

// Stejny rad jako MAX_EXPORT_ROWS u ostatnich exportu. Az soucty faktur
// bude pocitat databaze misto Node, muze strop zmizet.
const MAX_CUSTOMER_ROWS = 20_000;
const MAX_INVOICE_ROWS = 20_000;

export type CustomerSummary = {
  id: string;
  name: string;
  ico: string | null;
  dic: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  total_invoiced: number;
  outstanding: number;
  overdue_amount: number;
  overdue_count: number;
  invoice_count: number;
  last_invoice_date: string | null;
  reminder_policy_name: string | null;
};

export type CustomersPageData = {
  customers: CustomerSummary[];
  can_manage: boolean;
};

// Shared by the initial server-rendered page load (avoids the client-side
// "loading…" flash before the customer table appears) and GET /api/customers
// (used for client-side SWR refetches).
export async function loadCustomersPageData(identity: RequestIdentity | null): Promise<CustomersPageData> {
  if (!identity) throw new PageDataError("Nejste přihlášený uživatel.", 401);
  if (!canViewFinancialInsights(identity.membership.role)) throw new PageDataError("K seznamu zákazníků nemáte přístup.", 403);

  const organizationId = identity.membership.organization_id;
  const [
    { data: customers, error: customersError },
    { data: invoices, error: invoicesError },
    { data: preferences, error: preferencesError },
    { data: policies, error: policiesError },
  ] = await Promise.all([
    identity.service
      .from("customers")
      .select("id, name, ico, dic, email, phone, notes")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true })
      .limit(MAX_CUSTOMER_ROWS + 1),
    identity.service
      .from("invoices")
      .select("customer_id, amount, paid_amount, status, issue_date")
      .eq("organization_id", organizationId)
      .not("customer_id", "is", null)
      .limit(MAX_INVOICE_ROWS + 1),
    identity.service
      .from("counterparty_reminder_preferences")
      .select("counterparty_ico, reminder_policy_id")
      .eq("organization_id", organizationId),
    identity.service
      .from("reminder_policies")
      .select("id, name")
      .eq("organization_id", organizationId),
  ]);
  if (customersError || invoicesError || preferencesError || policiesError) {
    throw new PageDataError("Zákazníky se nepodařilo načíst. Zkuste to prosím znovu za chvíli.", 500);
  }
  // Tahle funkce agreguje soucty faktur v Node, takze si do pameti tahne
  // VSECHNY zakazniky i VSECHNY faktury organizace. Ostatni exporty maji
  // strop a vraci 413; tady zadny nebyl, takze dost velka organizace by
  // aplikaci polozila na pameti. Nez pribude agregace na strane databaze,
  // je lepsi srozumitelne selhat nez spadnout.
  if ((customers?.length ?? 0) > MAX_CUSTOMER_ROWS || (invoices?.length ?? 0) > MAX_INVOICE_ROWS) {
    throw new PageDataError(
      "Zákazníků je příliš mnoho na jedno zobrazení. Export prosím rozdělte podle období.",
      413,
    );
  }

  const policyNameById = new Map((policies ?? []).map((policy) => [policy.id, policy.name]));
  const policyNameByIco = new Map(
    (preferences ?? []).map((preference) => [preference.counterparty_ico, policyNameById.get(preference.reminder_policy_id) ?? null]),
  );

  type Aggregate = {
    total_invoiced: number;
    outstanding: number;
    overdue_amount: number;
    overdue_count: number;
    invoice_count: number;
    last_invoice_date: string | null;
  };
  const totalsByCustomer = new Map<string, Aggregate>();
  for (const invoice of invoices ?? []) {
    const customerId = invoice.customer_id as string;
    const row = totalsByCustomer.get(customerId) ?? {
      total_invoiced: 0,
      outstanding: 0,
      overdue_amount: 0,
      overdue_count: 0,
      invoice_count: 0,
      last_invoice_date: null,
    };
    const amount = Number(invoice.amount);
    const paidAmount = Number(invoice.paid_amount);
    if (invoice.status !== "cancelled") row.total_invoiced += amount;
    if (invoice.status === "pending" || invoice.status === "overdue") row.outstanding += amount - paidAmount;
    if (invoice.status === "overdue") {
      row.overdue_amount += amount - paidAmount;
      row.overdue_count += 1;
    }
    row.invoice_count += 1;
    if (!row.last_invoice_date || invoice.issue_date > row.last_invoice_date) row.last_invoice_date = invoice.issue_date;
    totalsByCustomer.set(customerId, row);
  }

  const emptyAggregate: Aggregate = {
    total_invoiced: 0,
    outstanding: 0,
    overdue_amount: 0,
    overdue_count: 0,
    invoice_count: 0,
    last_invoice_date: null,
  };

  return {
    customers: (customers ?? []).map((customer) => {
      const totals = totalsByCustomer.get(customer.id) ?? emptyAggregate;
      return {
        id: customer.id,
        name: customer.name,
        ico: customer.ico,
        dic: customer.dic,
        email: customer.email,
        phone: customer.phone,
        notes: customer.notes,
        reminder_policy_name: customer.ico ? (policyNameByIco.get(customer.ico) ?? null) : null,
        ...totals,
      };
    }),
    can_manage: canManageInvoices(identity.membership.role),
  };
}
