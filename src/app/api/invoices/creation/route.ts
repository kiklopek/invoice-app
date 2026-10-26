import { apiError } from "@/lib/api-response";
import { logError, requestId } from "@/lib/structured-log";
import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import {
  CREATION_COMPANY_FIELDS,
  CREATION_CUSTOMER_FIELDS,
  creationSupplier,
} from "@/lib/invoice-creation-server";
import { todayInTimeZone } from "@/lib/reminders";

export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  if (!identity)
    return NextResponse.json({ error: "Nejste přihlášeni." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role))
    return NextResponse.json(
      { error: "Nemáte oprávnění vystavovat faktury." },
      { status: 403 },
    );
  const org = identity.membership.organization_id;
  const customer = new URL(request.url).searchParams.get("customer_id");
  if (customer) {
    if (!/^[0-9a-f-]{36}$/i.test(customer))
      return NextResponse.json(
        { error: "Neplatný zákazník." },
        { status: 400 },
      );
    const { data, error } = await identity.service
      .from("customers")
      .select(CREATION_CUSTOMER_FIELDS)
      .eq("organization_id", org)
      .eq("id", customer)
      .maybeSingle();
    if (error) {
      logError("Zákazníka pro vystavení se nepodařilo načíst", error, { request_id: requestId(request) });
      return apiError(request, "Zákazníka se nepodařilo načíst.", 503, "customer_read_failed");
    }
    return data ? NextResponse.json({ customer: data }) : NextResponse.json({ error: "Zákazník nebyl nalezen." }, { status: 404 });
  }
  const today = todayInTimeZone(),
    prefix = `FV-${today.slice(0, 4)}-`;
  const [company, customers, last] = await Promise.all([
    identity.service
      .from("organizations")
      .select(CREATION_COMPANY_FIELDS)
      .eq("id", org)
      .single(),
    identity.service
      .from("customers")
      .select(CREATION_CUSTOMER_FIELDS)
      .eq("organization_id", org)
      .order("name")
      .limit(50),
    identity.service
      .from("invoices")
      .select("invoice_number")
      .eq("organization_id", org)
      .like("invoice_number", `${prefix}%`)
      .order("invoice_number", { ascending: false })
      .limit(1),
  ]);
  if (company.error || !company.data || customers.error || last.error) {
    logError("Údaje pro novou fakturu se nepodařilo načíst", company.error ?? customers.error ?? last.error, { request_id: requestId(request) });
    return apiError(request, "Údaje pro novou fakturu se nepodařilo načíst. Zkuste to znovu.", 503, "invoice_creation_read_failed");
  }
  const previous = last.data?.[0]?.invoice_number.slice(prefix.length) ?? "0";
  const next = /^\d{1,8}$/.test(previous) ? Number(previous) + 1 : 1;
  return NextResponse.json(
    {
      supplier: creationSupplier(company.data),
      customers: customers.data ?? [],
      today,
      suggested_number: `${prefix}${String(next).padStart(6, "0")}`,
      draft_scope: `${org}:${identity.user.id}`,
      can_send: Boolean(
        process.env.RESEND_API_KEY && process.env.REMINDER_EMAIL_FROM,
      ),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
