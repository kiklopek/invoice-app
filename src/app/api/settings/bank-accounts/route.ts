import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { canEditCompanySettings, canViewCompanySettings } from "@/lib/role-access";
import { canonicalAccount, matchOrganizationAccount, organizationAccounts } from "@/lib/bank-accounts";
import { INVOICE_CURRENCIES } from "@/lib/invoice-currency";

// Další bankovní účty firmy (Nastavení → Firma). Hlavní účet pro CZK/EUR
// zůstává ve firemních údajích; tady jsou účty, ze kterých firma nahrává
// výpisy navíc, a účty pro faktury v dalších měnách.
const COLUMNS = "id, account, currency, label, created_at";

export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canViewCompanySettings(identity.membership.role))
    return NextResponse.json({ error: "Čtenář nemá přístup k nastavení firmy." }, { status: 403 });
  const { data, error } = await identity.service.from("organization_bank_accounts").select(COLUMNS)
    .eq("organization_id", identity.membership.organization_id).order("created_at", { ascending: true });
  if (error) {
    logError("Bankovní účty se nepodařilo načíst", error);
    return apiError(request, "Bankovní účty se nepodařilo načíst.", 500, "bank_accounts_read_failed");
  }
  return NextResponse.json({ accounts: data ?? [] });
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { account?: unknown; currency?: unknown; label?: unknown } | null;
  const account = typeof body?.account === "string" ? body.account.replace(/\s/g, "").toUpperCase() : "";
  const currency = typeof body?.currency === "string" ? body.currency.trim().toUpperCase() : "";
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : null;
  const canonical = canonicalAccount(account);
  if (!canonical)
    return NextResponse.json({ error: "Zadejte účet ve tvaru předčíslí-číslo/kód banky nebo jako IBAN. Číslo neprošlo kontrolní číslicí." }, { status: 400 });
  if (!(INVOICE_CURRENCIES as readonly string[]).includes(currency))
    return NextResponse.json({ error: "Vyberte měnu účtu." }, { status: 400 });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canEditCompanySettings(identity.membership.role))
    return NextResponse.json({ error: "Bankovní účty může měnit pouze administrátor." }, { status: 403 });
  const { data: company } = await identity.service.from("organizations").select("bank_account_czk, bank_account_eur")
    .eq("id", identity.membership.organization_id).maybeSingle();
  if (company && matchOrganizationAccount(account, organizationAccounts(company)))
    return NextResponse.json({ error: "Tento účet už je hlavním účtem firmy." }, { status: 409 });
  const { data, error } = await identity.service.from("organization_bank_accounts").insert({
    organization_id: identity.membership.organization_id,
    account,
    canonical,
    currency,
    label,
    created_by: identity.user.id,
  }).select(COLUMNS).single();
  if (error?.code === "23505") return NextResponse.json({ error: "Tento účet už firma má." }, { status: 409 });
  if (error || !data) {
    logError("Bankovní účet se nepodařilo uložit", error);
    return apiError(request, "Bankovní účet se nepodařilo uložit.", 500, "bank_account_write_failed");
  }
  return NextResponse.json({ account: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const id = typeof body?.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : "";
  if (!id) return NextResponse.json({ error: "Chybí účet." }, { status: 400 });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canEditCompanySettings(identity.membership.role))
    return NextResponse.json({ error: "Bankovní účty může měnit pouze administrátor." }, { status: 403 });
  const { data, error } = await identity.service.from("organization_bank_accounts").delete()
    .eq("id", id).eq("organization_id", identity.membership.organization_id).select("id");
  if (error) {
    logError("Bankovní účet se nepodařilo odebrat", error, { account_id: id });
    return apiError(request, "Bankovní účet se nepodařilo odebrat.", 500, "bank_account_delete_failed");
  }
  if (!data?.length) return NextResponse.json({ error: "Účet nebyl nalezen." }, { status: 404 });
  return NextResponse.json({ removed: true });
}
