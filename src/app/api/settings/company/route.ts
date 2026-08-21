import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { isDemoMode } from "@/lib/supabase-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { canEditCompanySettings, canViewCompanySettings } from "@/lib/role-access";

const demoCompany = {
  name: "R. Hlavica s.r.o.",
  ico: "26296039",
  dic: "CZ26296039",
  registered_address: "Palackého třída 192/60, Brno-Královo Pole, 612 00",
  operating_address: "Podhradní Lhota 193, Rajnochovice, 768 71",
  data_box_id: "87qv26b",
  phone: "+420 573 500 700",
  email: "kostihova@hlavica.cz",
  bank_account_czk: "6844160247/0100",
  bank_account_eur: "94-2613370257/0100",
};

export async function GET() {
  if (isDemoMode()) return NextResponse.json({ company: demoCompany });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canViewCompanySettings(identity.membership.role)) return NextResponse.json({ error: "Čtenář nemá přístup k nastavení firmy." }, { status: 403 });
  const { data, error } = await identity.service.from("organizations").select("name, ico, dic, registered_address, operating_address, data_box_id, phone, email, bank_account_czk, bank_account_eur").eq("id", identity.membership.organization_id).single();
  if (error) return NextResponse.json({ error: "Firemní údaje se nepodařilo načíst." }, { status: 500 });
  return NextResponse.json({ company: data });
}

export async function PUT(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  const fields = ["name", "ico", "dic", "registered_address", "operating_address", "data_box_id", "phone", "email", "bank_account_czk", "bank_account_eur"] as const;
  const company = Object.fromEntries(fields.map(field => [field, typeof body[field] === "string" ? body[field].trim().slice(0, 300) : ""]));
  if (!company.name || !/^\d{8}$/.test(company.ico) || !/^\S+@\S+\.\S+$/.test(company.email)) return NextResponse.json({ error: "Zkontrolujte název, osmimístné IČO a e-mail." }, { status: 400 });
  if (isDemoMode()) return NextResponse.json({ company, saved: true });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canEditCompanySettings(identity.membership.role)) return NextResponse.json({ error: "Firemní údaje může měnit pouze administrátor." }, { status: 403 });
  const { data, error } = await identity.service.from("organizations").update(company).eq("id", identity.membership.organization_id).select("name, ico, dic, registered_address, operating_address, data_box_id, phone, email, bank_account_czk, bank_account_eur").single();
  if (error) return NextResponse.json({ error: "Firemní údaje se nepodařilo uložit." }, { status: 500 });
  return NextResponse.json({ company: data, saved: true });
}
