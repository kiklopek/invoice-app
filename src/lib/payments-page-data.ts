import "server-only";

import type { RequestIdentity } from "@/lib/auth";
import { canAccessOperations, canManageInvoices } from "@/lib/role-access";
import { canUseGpcImport } from "@/lib/gpc-feature";
import { PageDataError } from "@/lib/dashboard-page-data";

export type PaymentsPagePayment = {
  id: string;
  external_id: string;
  booked_on: string;
  amount: number;
  currency: string;
  variable_symbol: string | null;
  counterparty_name: string | null;
  match_status: "matched" | "split" | "unmatched" | "ambiguous";
  source: "bank_import" | "manual";
  invoice_id: string | null;
  invoices?: { invoice_number: string; counterparty_name: string } | null;
  allocations: Array<{ invoice_id: string; amount: number; invoice_number: string; counterparty_name: string }>;
};
export type PaymentsPageOpenInvoice = {
  id: string;
  invoice_number: string;
  counterparty_name: string;
  amount: number;
  paid_amount: number;
  currency: string;
  variable_symbol: string | null;
};
export type PaymentsPageData = {
  payments: PaymentsPagePayment[];
  open_invoices: PaymentsPageOpenInvoice[];
  can_manage: boolean;
  gpc_enabled: boolean;
  runtime_mode: "production-database";
};

// Shared by the initial server-rendered page load (avoids the client-side
// "loading…" flash before the import panel appears) and GET /api/payments
// (used for refetching after a mutation).
export async function loadPaymentsPageData(identity: RequestIdentity | null): Promise<PaymentsPageData> {
  if (!identity) throw new PageDataError("Nejste přihlášený uživatel.", 401);
  if (!canAccessOperations(identity.membership.role)) throw new PageDataError("Čtenář nemá přístup ke správě bankovních plateb.", 403);

  const organizationId = identity.membership.organization_id;
  const [{ data, error }, { data: openInvoices, error: invoiceError }] = await Promise.all([
    identity.service
      .from("bank_payments")
      .select(
        "id, external_id, booked_on, amount, currency, variable_symbol, counterparty_name, match_status, source, invoice_id, invoices!bank_payments_invoice_id_fkey(invoice_number, counterparty_name)",
      )
      .eq("organization_id", organizationId)
      .order("booked_on", { ascending: false })
      .limit(100),
    identity.service
      .from("invoices")
      .select("id, invoice_number, counterparty_name, amount, paid_amount, currency, variable_symbol")
      .eq("organization_id", organizationId)
      .in("status", ["pending", "overdue"])
      .order("due_date", { ascending: true })
      .limit(500),
  ]);
  if (error || invoiceError) throw new PageDataError("Bankovní platby se nepodařilo načíst. Zkontrolujte poslední databázovou migraci.", 500);

  const paymentIds = (data ?? []).map((payment) => payment.id);
  const { data: allocations } = paymentIds.length
    ? await identity.service
        .from("bank_payment_allocations")
        .select("bank_payment_id, invoice_id, amount")
        .eq("organization_id", organizationId)
        .eq("is_committed", true)
        .in("bank_payment_id", paymentIds)
    : { data: [] };
  const allocationInvoiceIds = [...new Set((allocations ?? []).map((allocation) => allocation.invoice_id))];
  const { data: allocationInvoices } = allocationInvoiceIds.length
    ? await identity.service
        .from("invoices")
        .select("id, invoice_number, counterparty_name")
        .eq("organization_id", organizationId)
        .in("id", allocationInvoiceIds)
    : { data: [] };
  const invoiceById = new Map((allocationInvoices ?? []).map((invoice) => [invoice.id, invoice]));
  const allocationsByPayment = new Map<string, PaymentsPagePayment["allocations"]>();
  for (const allocation of allocations ?? [])
    allocationsByPayment.set(allocation.bank_payment_id!, [
      ...(allocationsByPayment.get(allocation.bank_payment_id!) ?? []),
      {
        invoice_id: allocation.invoice_id,
        amount: Number(allocation.amount),
        invoice_number: invoiceById.get(allocation.invoice_id)?.invoice_number ?? "Faktura",
        counterparty_name: invoiceById.get(allocation.invoice_id)?.counterparty_name ?? "",
      },
    ]);

  return {
    payments: (data ?? []).map((payment) => ({
      ...payment,
      allocations: allocationsByPayment.get(payment.id) ?? [],
    })) as PaymentsPagePayment[],
    open_invoices: openInvoices ?? [],
    can_manage: canManageInvoices(identity.membership.role),
    gpc_enabled: canUseGpcImport(identity.membership.role),
    runtime_mode: "production-database",
  };
}
