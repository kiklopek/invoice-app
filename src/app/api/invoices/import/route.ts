import { NextResponse } from "next/server";
import { subscriptionBlock } from "@/lib/billing-server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { parseInvoiceInput } from "@/lib/invoice-validation";
import { initialNextReminderAt, todayInTimeZone } from "@/lib/reminders";
import { isSameOriginMutation } from "@/lib/request-security";
import { isBlockedReminderRecipient } from "@/lib/reminder-recipient-policy";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";

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

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  const subscriptionBlocked = await subscriptionBlock(identity);
  if (subscriptionBlocked) return subscriptionBlocked;
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění importovat faktury." }, { status: 403 });

  const organizationId = identity.membership.organization_id;
  const { data: issuer, error: issuerError } = await identity.service.from("organizations")
    .select("name, email").eq("id", organizationId).single();
  if (issuerError || !issuer) {
    logError("Firemní údaje pro ověření importovaných příjemců upomínek se nepodařilo načíst", issuerError);
    return apiError(request, "Firemní údaje se nepodařilo ověřit.", 503, "invoice_import_issuer_read_failed");
  }
  const ownEmailRows = invoices.flatMap((invoice, index) => isBlockedReminderRecipient(invoice.counterparty_email, issuer) ? [index + 2] : []);
  if (ownEmailRows.length) {
    return NextResponse.json({ error: `E-mail pro upomínky na řádku ${ownEmailRows.slice(0, 10).join(", ")} patří vaší firmě. Zadejte adresu odběratele.` }, { status: 400 });
  }
  const { data: policy } = await identity.service.from("reminder_policies")
    .select("id, days_from_due, is_active")
    .eq("organization_id", organizationId).eq("is_default", true).is("archived_at", null).maybeSingle();
  const today = todayInTimeZone();
  const rows = invoices.map((invoice) => ({
    ...invoice,
    source: "manual",
    file_url: null,
    organization_id: organizationId,
    reminder_policy_id: policy?.id ?? null,
    reminder_days_snapshot: policy?.days_from_due ?? [-3, 0, 7, 14],
    reminder_plan_effective_from: null,
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
