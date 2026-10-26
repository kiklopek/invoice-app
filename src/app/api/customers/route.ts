import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError, requestId } from "@/lib/structured-log";
import { getRequestIdentity } from "@/lib/auth";
import { loadCustomersPageData } from "@/lib/customers-page-data";
import { PageDataError } from "@/lib/dashboard-page-data";
import { createExcelWorkbook, excelDate, excelResponse } from "@/lib/excel-export";

export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  try {
    const data = await loadCustomersPageData(identity);
    if (new URL(request.url).searchParams.get("format") === "xlsx") {
      const moneyFormat = "#,##0.00";
      const bytes = await createExcelWorkbook("Zákazníci", [
        { header: "Název", key: "name", width: 32 },
        { header: "IČO", key: "ico", width: 14 },
        { header: "DIČ", key: "dic", width: 16 },
        { header: "E-mail", key: "email", width: 28 },
        { header: "Telefon", key: "phone", width: 16 },
        { header: "Celkem fakturováno", key: "total", width: 19, numberFormat: moneyFormat },
        { header: "Neuhrazeno", key: "outstanding", width: 16, numberFormat: moneyFormat },
        { header: "Po splatnosti", key: "overdue", width: 16, numberFormat: moneyFormat },
        { header: "Kategorie upomínek", key: "reminderPolicy", width: 20 },
        { header: "Poslední faktura", key: "lastInvoice", width: 16, numberFormat: "dd.mm.yyyy" },
      ], data.customers.map((customer) => ({
        name: customer.name,
        ico: customer.ico,
        dic: customer.dic,
        email: customer.email,
        phone: customer.phone,
        total: customer.total_invoiced,
        outstanding: customer.outstanding,
        overdue: customer.overdue_amount,
        reminderPolicy: customer.reminder_policy_name ?? "nepřiřazeno",
        lastInvoice: excelDate(customer.last_invoice_date),
      })));
      return excelResponse(bytes, "zakaznici.xlsx");
    }
    return NextResponse.json(data);
  } catch (cause) {
    if (cause instanceof PageDataError) return NextResponse.json({ error: cause.message }, { status: cause.status });
    logError("Zákazníky se nepodařilo načíst", cause, { request_id: requestId(request) });
    return apiError(request, "Zákazníky se nepodařilo načíst. Zkuste to prosím znovu za chvíli.", 500, "customers_read_failed");
  }
}

/** Shared customer registry; creation from an invoice never writes another tenant. */
export async function POST(request: Request) {
  const { isSameOriginMutation } = await import("@/lib/request-security");
  const { canManageInvoices } = await import("@/lib/auth");
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Nepovolený původ požadavku." }, { status: 403 });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášeni." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění přidat zákazníka." }, { status: 403 });
  const raw = await request.json().catch(() => null) as Record<string, unknown> | null;
  const fields = ["name", "ico", "dic", "email", "address"] as const;
  if (!raw || fields.some(key => typeof raw[key] !== "string" || String(raw[key]).length > (key === "email" ? 254 : key === "ico" ? 8 : key === "dic" ? 24 : key === "name" ? 200 : 500))) return NextResponse.json({ error: "Zkontrolujte údaje zákazníka." }, { status: 400 });
  const name = String(raw.name).trim(), ico = String(raw.ico).trim(), dic = String(raw.dic).trim(), email = String(raw.email).trim().toLowerCase(), address = String(raw.address).trim();
  if (!name || !address || (ico && !/^\d{8}$/.test(ico)) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return NextResponse.json({ error: "Doplňte název, adresu a platné identifikační údaje zákazníka." }, { status: 400 });
  const org = identity.membership.organization_id;
  let lookup = identity.service.from("customers").select("id, name, ico, dic, email, address").eq("organization_id", org);
  lookup = ico ? lookup.eq("ico", ico) : lookup.eq("name", name).eq("address", address);
  const { data: existing, error: lookupError } = await lookup.limit(1).maybeSingle();
  if (lookupError) {
    logError("Zákazníka se nepodařilo ověřit", lookupError, { request_id: requestId(request) });
    return apiError(request, "Zákazníka se nepodařilo ověřit.", 503, "customer_lookup_failed");
  }
  if (existing) return NextResponse.json({ customer: existing, existing: true });
  const { data, error } = await identity.service.from("customers").insert({ organization_id: org, created_by: identity.user.id, name, ico: ico || null, dic: dic || null, email: email || null, address }).select("id, name, ico, dic, email, address").single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Zákazník s tímto IČO již existuje. Vyberte jej ve vyhledávání." }, { status: 409 });
    logError("Zákazníka se nepodařilo uložit", error, { request_id: requestId(request) });
    return apiError(request, "Zákazníka se nepodařilo uložit.", 503, "customer_insert_failed");
  }
  return NextResponse.json({ customer: data }, { status: 201 });
}
