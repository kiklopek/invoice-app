import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { canAccessOperations } from "@/lib/role-access";
import { isSameOriginMutation } from "@/lib/request-security";
import { isDemoMode } from "@/lib/supabase-server";
import { DEFAULT_REMINDER_DAYS, normalizeReminderDays } from "@/lib/reminder-policies";

const demoPolicies = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Standardní", is_default: true, days_from_due: [...DEFAULT_REMINDER_DAYS], archived_at: null },
];

function validName(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 100 ? value.trim() : null;
}

export async function GET() {
  if (isDemoMode()) return NextResponse.json({ policies: demoPolicies });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canAccessOperations(identity.membership.role)) return NextResponse.json({ error: "Nemáte přístup ke kategoriím upomínek." }, { status: 403 });
  const { data, error } = await identity.service.from("reminder_policies")
    .select("id, name, is_default, days_from_due, archived_at")
    .eq("organization_id", identity.membership.organization_id)
    .order("is_default", { ascending: false }).order("name");
  if (error) return NextResponse.json({ error: "Kategorie upomínek se nepodařilo načíst. Zkontrolujte databázovou migraci." }, { status: 500 });
  return NextResponse.json({ policies: data ?? [] }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { name?: unknown; days?: unknown } | null;
  const name = validName(body?.name);
  const days = normalizeReminderDays(body?.days);
  if (!name || !days) return NextResponse.json({ error: "Zadejte název a 1 až 10 platných termínů." }, { status: 400 });
  if (isDemoMode()) return NextResponse.json({ policy: { id: crypto.randomUUID(), name, is_default: false, days_from_due: days, archived_at: null } }, { status: 201 });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění spravovat kategorie." }, { status: 403 });
  const org = identity.membership.organization_id;
  const { data: defaultPolicy } = await identity.service.from("reminder_policies").select("is_active").eq("organization_id", org).eq("is_default", true).maybeSingle();
  const { data, error } = await identity.service.from("reminder_policies").insert({ organization_id: org, name, days_from_due: days, is_default: false, is_active: defaultPolicy?.is_active ?? true }).select("id, name, is_default, days_from_due, archived_at").single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "Kategorie s tímto názvem už existuje." : "Kategorii se nepodařilo vytvořit." }, { status: error.code === "23505" ? 409 : 500 });
  await identity.service.from("reminder_settings_events").insert({ organization_id: org, actor_user_id: identity.user.id, actor_email: identity.user.email?.toLowerCase() ?? "", is_active: defaultPolicy?.is_active ?? true, days_from_due: days, template_data: { event: "category_created", policy_id: data.id, name } });
  return NextResponse.json({ policy: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: unknown; name?: unknown; days?: unknown; make_default?: unknown } | null;
  if (typeof body?.id !== "string") return NextResponse.json({ error: "Chybí kategorie." }, { status: 400 });
  const name = validName(body.name);
  const days = normalizeReminderDays(body.days);
  if (!name || !days || (body.make_default !== undefined && typeof body.make_default !== "boolean")) return NextResponse.json({ error: "Zkontrolujte název a termíny kategorie." }, { status: 400 });
  if (isDemoMode()) return NextResponse.json({ policy: { id: body.id, name, is_default: Boolean(body.make_default), days_from_due: days, archived_at: null } });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění spravovat kategorie." }, { status: 403 });
  const org = identity.membership.organization_id;
  const { data: existing } = await identity.service.from("reminder_policies").select("id, is_default").eq("organization_id", org).eq("id", body.id).is("archived_at", null).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Kategorie nebyla nalezena." }, { status: 404 });
  if (body.make_default && !existing.is_default) {
    const { error: defaultError } = await identity.service.rpc("set_default_reminder_policy", { target_org: org, target_policy: body.id });
    if (defaultError) return NextResponse.json({ error: "Výchozí kategorii se nepodařilo změnit. Zkontrolujte databázovou migraci." }, { status: 500 });
  }
  const { data, error } = await identity.service.from("reminder_policies").update({ name, days_from_due: days, updated_at: new Date().toISOString() })
    .eq("organization_id", org).eq("id", body.id).is("archived_at", null).select("id, name, is_default, days_from_due, archived_at").maybeSingle();
  if (error || !data) return NextResponse.json({ error: error?.code === "23505" ? "Kategorie s tímto názvem už existuje." : "Kategorii se nepodařilo uložit." }, { status: error?.code === "23505" ? 409 : 500 });
  await identity.service.from("reminder_settings_events").insert({ organization_id: org, actor_user_id: identity.user.id, actor_email: identity.user.email?.toLowerCase() ?? "", is_active: true, days_from_due: days, template_data: { event: body.make_default ? "category_made_default" : "category_updated", policy_id: data.id, name } });
  return NextResponse.json({ policy: data });
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Chybí kategorie." }, { status: 400 });
  if (isDemoMode()) return NextResponse.json({ deleted: true });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění spravovat kategorie." }, { status: 403 });
  const org = identity.membership.organization_id;
  const { data: policy } = await identity.service.from("reminder_policies").select("is_default").eq("organization_id", org).eq("id", id).is("archived_at", null).maybeSingle();
  if (!policy) return NextResponse.json({ error: "Kategorie nebyla nalezena." }, { status: 404 });
  if (policy.is_default) return NextResponse.json({ error: "Nejdříve nastavte jinou výchozí kategorii." }, { status: 409 });
  const { error } = await identity.service.from("reminder_policies").update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", org).eq("id", id);
  if (error) return NextResponse.json({ error: "Kategorii se nepodařilo smazat." }, { status: 500 });
  await identity.service.from("reminder_settings_events").insert({ organization_id: org, actor_user_id: identity.user.id, actor_email: identity.user.email?.toLowerCase() ?? "", is_active: true, days_from_due: [], template_data: { event: "category_archived", policy_id: id } });
  return NextResponse.json({ deleted: true });
}
