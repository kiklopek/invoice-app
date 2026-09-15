import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import {
  canEditCompanySettings,
  canViewCompanySettings,
} from "@/lib/role-access";

export async function GET() {
  const identity = await getRequestIdentity();
  if (!identity)
    return NextResponse.json(
      { error: "Nejste přihlášený uživatel." },
      { status: 401 },
    );
  if (!canViewCompanySettings(identity.membership.role))
    return NextResponse.json(
      { error: "Čtenář nemá přístup k nastavení firmy." },
      { status: 403 },
    );
  const { data, error } = await identity.service
    .from("organizations")
    .select(
      "name, ico, dic, registered_address, operating_address, data_box_id, phone, email, bank_account_czk, bank_account_eur, settings_revision",
    )
    .eq("id", identity.membership.organization_id)
    .single();
  if (error)
    return NextResponse.json(
      { error: "Firemní údaje se nepodařilo načíst." },
      { status: 500 },
    );
  return NextResponse.json({
    company: { ...data, revision: data.settings_revision },
  });
}

export async function PUT(request: Request) {
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Požadavek pochází z nepovoleného webu." },
      { status: 403 },
    );
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body)
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  const fields = [
    "name",
    "ico",
    "dic",
    "registered_address",
    "operating_address",
    "data_box_id",
    "phone",
    "email",
    "bank_account_czk",
    "bank_account_eur",
  ] as const;
  const company = Object.fromEntries(
    fields.map((field) => [
      field,
      typeof body[field] === "string" ? body[field].trim().slice(0, 300) : "",
    ]),
  ) as Record<(typeof fields)[number], string>;
  const expectedRevision = Number(body.revision);
  if (
    !company.name ||
    !/^\d{8}$/.test(company.ico) ||
    !/^\S+@\S+\.\S+$/.test(company.email)
  )
    return NextResponse.json(
      { error: "Zkontrolujte název, osmimístné IČO a e-mail." },
      { status: 400 },
    );
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
    return NextResponse.json(
      { error: "Neplatná revize nastavení." },
      { status: 400 },
    );
  const identity = await getRequestIdentity();
  if (!identity)
    return NextResponse.json(
      { error: "Nejste přihlášený uživatel." },
      { status: 401 },
    );
  if (!canEditCompanySettings(identity.membership.role))
    return NextResponse.json(
      { error: "Firemní údaje může měnit pouze administrátor." },
      { status: 403 },
    );
  const { data, error } = await identity.service
    .from("organizations")
    .update({ ...company, settings_revision: expectedRevision + 1 })
    .eq("id", identity.membership.organization_id)
    .eq("settings_revision", expectedRevision)
    .select(
      "name, ico, dic, registered_address, operating_address, data_box_id, phone, email, bank_account_czk, bank_account_eur, settings_revision",
    )
    .maybeSingle();
  if (error)
    return NextResponse.json(
      { error: "Firemní údaje se nepodařilo uložit." },
      { status: 500 },
    );
  if (!data)
    return NextResponse.json(
      {
        error:
          "Nastavení mezitím změnil jiný uživatel. Načtěte stránku znovu a změny porovnejte.",
      },
      { status: 409 },
    );
  return NextResponse.json({
    company: { ...data, revision: data.settings_revision },
    saved: true,
  });
}
