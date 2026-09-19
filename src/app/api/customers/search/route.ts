import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { canViewFinancialInsights } from "@/lib/role-access";

export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canViewFinancialInsights(identity.membership.role))
    return NextResponse.json({ error: "K vyhledávání zákazníků nemáte přístup." }, { status: 403 });

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ customers: [] });

  const escaped = query.replace(/[%_]/g, (match) => `\\${match}`);
  const { data, error } = await identity.service
    .from("customers")
    .select("id, name, ico, dic, email")
    .eq("organization_id", identity.membership.organization_id)
    .or(`name.ilike.%${escaped}%,ico.ilike.%${escaped}%,email.ilike.%${escaped}%,phone.ilike.%${escaped}%`)
    .order("name", { ascending: true })
    .limit(10);
  if (error) return NextResponse.json({ error: "Zákazníky se nepodařilo vyhledat." }, { status: 500 });
  return NextResponse.json({ customers: data ?? [] });
}
