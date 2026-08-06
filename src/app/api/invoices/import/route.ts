import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { parseInvoiceInput } from "@/lib/invoice-validation";
import { initialNextReminderAt, todayInTimeZone } from "@/lib/reminders";
import { isDemoMode } from "@/lib/supabase-server";
import { isSameOriginMutation } from "@/lib/request-security";

const MAX_BATCH_SIZE = 250;

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { invoices?: unknown } | null;
  if (!body || !Array.isArray(body.invoices) || body.invoices.length < 1 || body.invoices.length > MAX_BATCH_SIZE) {
    return NextResponse.json({ error: `Import musí obsahovat 1 až ${MAX_BATCH_SIZE} faktur.` }, { status: 400 });
  }

  const parsed = body.invoices.map(parseInvoiceInput);
  const invalidRows = parsed.flatMap((invoice, index) => invoice ? [] : [index + 2]);
  if (invalidRows.length) {
    return NextResponse.json({ error: `Neplatné údaje na řádku ${invalidRows.slice(0, 10).join(", ")}.` }, { status: 400 });
  }
  const invoices = parsed.filter((invoice): invoice is NonNullable<typeof invoice> => Boolean(invoice));
  const numbers = new Set<string>();
  const duplicate = invoices.find((invoice) => numbers.has(invoice.invoice_number) || !numbers.add(invoice.invoice_number));
  if (duplicate) return NextResponse.json({ error: `Číslo faktury ${duplicate.invoice_number} je v souboru vícekrát.` }, { status: 409 });

  if (isDemoMode()) return NextResponse.json({ imported: invoices.length }, { status: 201 });

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění importovat faktury." }, { status: 403 });

  const organizationId = identity.membership.organization_id;
  const { data: policy } = await identity.service.from("reminder_policies")
    .select("id, days_from_due, is_active")
    .eq("organization_id", organizationId).eq("is_default", true).maybeSingle();
  const today = todayInTimeZone();
  const rows = invoices.map((invoice) => ({
    ...invoice,
    source: "manual",
    file_url: null,
    organization_id: organizationId,
    reminder_policy_id: policy?.id ?? null,
    next_reminder_at: policy?.is_active === false
      ? null
      : initialNextReminderAt(invoice.due_date, policy?.days_from_due ?? [-3, 0, 7, 14], today),
    created_by: identity.user.id,
  }));

  const { data, error } = await identity.service.from("invoices").insert(rows).select("id");
  if (error) {
    return NextResponse.json({ error: error.code === "23505" ? "Některé číslo faktury už v databázi existuje. Nebyla importována žádná faktura." : "Hromadný import se nepodařilo uložit." }, { status: error.code === "23505" ? 409 : 500 });
  }
  return NextResponse.json({ imported: data?.length ?? invoices.length }, { status: 201 });
}
