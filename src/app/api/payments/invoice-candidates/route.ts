import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { canUseGpcImport } from "@/lib/gpc-feature";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  if (!identity)
    return NextResponse.json(
      { error: "Nejste přihlášený uživatel." },
      { status: 401 },
    );
  if (
    !canManageInvoices(identity.membership.role) ||
    !canUseGpcImport(identity.membership.role)
  )
    return NextResponse.json(
      { error: "Nemáte oprávnění vyhledávat faktury pro párování." },
      { status: 403 },
    );
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim();
  const page = Number(params.get("page") ?? "1");
  if (query.length > 100 || !Number.isInteger(page) || page < 1)
    return NextResponse.json(
      { error: "Neplatné hledání nebo stránka." },
      { status: 400 },
    );
  // Kontext platby, pro kterou se faktura vybírá: podle něj se nahoru řadí
  // nejpravděpodobnější faktury. Nic se tím nepřiřazuje.
  const rawAmount = params.get("amount");
  const amount = rawAmount ? Number(rawAmount) : null;
  const currency = params.get("currency")?.trim().toUpperCase() || null;
  const vs = params.get("vs")?.trim() || null;
  const name = params.get("name")?.trim() || null;
  const prefer = (params.get("prefer") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (
    (amount !== null && (!Number.isFinite(amount) || amount <= 0)) ||
    (currency && !/^[A-Z]{3}$/.test(currency)) ||
    (vs && vs.length > 20) ||
    (name && name.length > 200) ||
    prefer.length > 20 ||
    prefer.some((id) => !UUID.test(id))
  )
    return NextResponse.json(
      { error: "Neplatné údaje platby pro řazení faktur." },
      { status: 400 },
    );
  const { data, error } = await identity.service.rpc(
    "rank_open_invoice_candidates",
    {
      target_org: identity.membership.organization_id,
      actor_user: identity.user.id,
      search_query: query || undefined,
      page_number: page,
      page_size: 25,
      payment_amount: amount ?? undefined,
      payment_currency: currency ?? undefined,
      payment_vs: vs ?? undefined,
      payment_name: name ?? undefined,
      prefer_invoice_ids: prefer.length ? prefer : undefined,
    },
  );
  if (error) {
    logError("Kandidátní faktury se nepodařilo načíst", error);
    return apiError(request, "Kandidátní faktury se nepodařilo načíst.", 500, "invoice_candidates_read_failed");
  }
  return NextResponse.json(data, {
    headers: { "cache-control": "private, no-store" },
  });
}
