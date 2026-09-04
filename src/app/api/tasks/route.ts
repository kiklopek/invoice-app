import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { demoInvoices } from "@/lib/demo-data";
import { canAccessOperations } from "@/lib/role-access";
import { isDemoMode } from "@/lib/supabase-server";
import type { TodayTaskGroup, TodayTasksResponse } from "@/types/today-tasks";

const response = (groups: TodayTaskGroup[]) => NextResponse.json<TodayTasksResponse>({
  total: groups.reduce((sum, group) => sum + group.count, 0),
  groups,
}, { headers: { "cache-control": "private, no-store" } });

export async function GET() {
  if (isDemoMode()) {
    const overdue = demoInvoices.filter((invoice) => invoice.status === "overdue");
    return response([{
      key: "overdue",
      label: "Faktury po splatnosti",
      description: "Odběratelé, u kterých je potřeba zkontrolovat úhradu nebo kontakt.",
      count: overdue.length,
      items: overdue.slice(0, 8).map((invoice) => ({
        id: invoice.id,
        title: invoice.invoice_number,
        detail: `${invoice.counterparty_name} · splatnost ${invoice.due_date}`,
        href: `/invoices/${invoice.id}`,
      })),
    }]);
  }

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canAccessOperations(identity.membership.role)) {
    return NextResponse.json({ error: "K pracovní frontě nemáte přístup." }, { status: 403 });
  }

  const organizationId = identity.membership.organization_id;
  const db = identity.userClient;
  const [overdue, payments, email, addresses, documents] = await Promise.all([
    db.from("invoices").select("id, invoice_number, counterparty_name, due_date", { count: "exact" })
      .eq("organization_id", organizationId).eq("status", "overdue").order("due_date").limit(8),
    db.from("bank_payments").select("id, amount, currency, booked_on, counterparty_name", { count: "exact" })
      .eq("organization_id", organizationId).neq("match_status", "matched").order("booked_on", { ascending: false }).limit(8),
    db.from("reminder_log").select("id, invoice_id, sent_to, error_message, updated_at", { count: "exact" })
      .eq("organization_id", organizationId).eq("status", "failed").order("updated_at", { ascending: false }).limit(8),
    db.from("email_suppressions").select("id, email, reason, last_event_at", { count: "exact" })
      .eq("organization_id", organizationId).order("last_event_at", { ascending: false }).limit(8),
    db.from("invoice_uploads").select("id, original_name, ocr_status, ocr_error, created_at", { count: "exact" })
      .eq("organization_id", organizationId).is("invoice_id", null).or("ocr_status.eq.failed,status.eq.verified").order("created_at", { ascending: false }).limit(8),
  ]);

  const failed = [overdue, payments, email, addresses, documents].find((result) => result.error)?.error;
  if (failed) return NextResponse.json({ error: "Úkoly se nepodařilo načíst." }, { status: 500 });

  return response([
    {
      key: "overdue", label: "Faktury po splatnosti", description: "Zkontrolujte platbu nebo kontaktujte odběratele.", count: overdue.count ?? 0,
      items: (overdue.data ?? []).map((item) => ({ id: item.id, title: item.invoice_number, detail: `${item.counterparty_name} · splatnost ${item.due_date}`, href: `/invoices/${item.id}` })),
    },
    {
      key: "payments", label: "Nespárované platby", description: "Platby, které automat nespároval s jedinou fakturou.", count: payments.count ?? 0,
      items: (payments.data ?? []).map((item) => ({ id: item.id, title: `${Number(item.amount).toLocaleString("cs-CZ")} ${item.currency}`, detail: `${item.counterparty_name ?? "Neznámý plátce"} · ${item.booked_on}`, href: "/invoices/payments" })),
    },
    {
      key: "email", label: "Neúspěšné e-maily", description: "Upomínky, které je potřeba opravit a poslat znovu.", count: email.count ?? 0,
      items: (email.data ?? []).map((item) => ({ id: item.id, title: item.sent_to, detail: item.error_message ?? "Odeslání selhalo", href: `/invoices/${item.invoice_id}` })),
    },
    {
      key: "addresses", label: "Problematické adresy", description: "Adresy označené poskytovatelem jako nedoručitelné nebo stěžující si.", count: addresses.count ?? 0,
      items: (addresses.data ?? []).map((item) => ({ id: item.id, title: item.email, detail: item.reason === "complained" ? "Příjemce označil zprávu jako spam" : "Adresa vrací nedoručitelné zprávy", href: "/reminders" })),
    },
    {
      key: "documents", label: "Dokumenty ke kontrole", description: "Nahrané dokumenty bez faktury nebo s neúspěšným OCR.", count: documents.count ?? 0,
      items: (documents.data ?? []).map((item) => ({ id: item.id, title: item.original_name, detail: item.ocr_status === "failed" ? item.ocr_error ?? "OCR se nezdařilo" : "Čeká na ruční dokončení", href: "/invoices/import" })),
    },
  ]);
}
