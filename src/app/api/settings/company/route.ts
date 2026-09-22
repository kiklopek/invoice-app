import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { getRequestIdentity } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/request-security";
import { validateCompanyFields } from "@/lib/company-validation";
import {
  canEditCompanySettings,
  canViewCompanySettings,
} from "@/lib/role-access";

export async function GET(request: Request) {
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
  if (error) {
    logError("Firemní údaje se nepodařilo načíst", error);
    return apiError(request, "Firemní údaje se nepodařilo načíst.", 500, "company_read_failed");
  }
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
  // Dřív se ověřovalo jen "IČO má osm číslic" a čísla účtů vůbec.
  // Chybný účet se přitom projeví až za týden jako "platby nedorazily",
  // protože párování výpisů hlásí neshodu účtu. Validace je i na klientovi,
  // ale spolehnout se na ni nelze -- request může přijít odkudkoli.
  const fieldErrors = validateCompanyFields(company);
  if (fieldErrors.length)
    return NextResponse.json(
      { error: fieldErrors.map((problem) => problem.message).join(" ") },
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
  if (error) {
    logError("Firemní údaje se nepodařilo uložit", error);
    return apiError(request, "Firemní údaje se nepodařilo uložit.", 500, "company_write_failed");
  }
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
