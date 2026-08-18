import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { isDemoMode } from "@/lib/supabase-server";
import type { ReminderStage } from "@/types/invoice";
import { isSameOriginMutation } from "@/lib/request-security";
import { unsupportedTemplateVariables } from "@/lib/reminder-template";
import { defaultReminderTemplates } from "@/lib/reminder-defaults";
import { normalizeReminderDeliverySettings } from "@/lib/reminder-recipients";

const stages: ReminderStage[] = ["before_due", "on_due", "overdue", "escalation"];
type ReminderTemplateSettings = { subject: string; body: string; reply_to: string | null; cc: string[] };

function templatesWithDeliveryDefaults() {
  return stages.reduce<Record<ReminderStage, ReminderTemplateSettings>>((result, stage) => {
    result[stage] = { ...defaultReminderTemplates[stage], reply_to: null, cc: [] };
    return result;
  }, {} as Record<ReminderStage, ReminderTemplateSettings>);
}

export async function GET() {
  if (isDemoMode()) return NextResponse.json({
    active: true, days: [-3, 0, 7, 14], templates: templatesWithDeliveryDefaults(),
    last_change: { id: "demo-settings-change", changed_at: new Date(Date.now() - 86_400_000).toISOString(), changed_by: "kostihova@hlavica.cz" },
  });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (identity.membership.role === "viewer") return NextResponse.json({ error: "Čtenář nemá přístup k nastavení upomínek." }, { status: 403 });

  const org = identity.membership.organization_id;
  const [policyResult, templatesResult, changeResult] = await Promise.all([
    identity.service.from("reminder_policies").select("days_from_due, is_active").eq("organization_id", org).eq("is_default", true).maybeSingle(),
    identity.service.from("email_templates").select("stage, subject, body, reply_to, cc").eq("organization_id", org),
    identity.service.from("reminder_settings_events").select("id, actor_email, created_at")
      .eq("organization_id", org).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (policyResult.error || templatesResult.error || changeResult.error) return NextResponse.json({ error: "Nastavení upomínek se nepodařilo načíst. Zkontrolujte databázovou migraci." }, { status: 500 });
  const policy = policyResult.data;
  const templates = templatesResult.data;
  const merged = templatesWithDeliveryDefaults();
  for (const template of templates ?? []) if (stages.includes(template.stage)) merged[template.stage as ReminderStage] = {
    subject: template.subject,
    body: template.body,
    reply_to: template.reply_to ?? null,
    cc: template.cc ?? [],
  };
  return NextResponse.json({
    active: policy?.is_active ?? true, days: policy?.days_from_due ?? [-3, 0, 7, 14], templates: merged,
    last_change: changeResult.data ? { id: changeResult.data.id, changed_at: changeResult.data.created_at, changed_by: changeResult.data.actor_email } : null,
  }, { headers: { "cache-control": "private, no-store" } });
}

export async function PUT(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { active?: unknown; days?: unknown; templates?: unknown } | null;
  if (typeof body?.active !== "boolean") return NextResponse.json({ error: "Zvolte, zda má být automatické odesílání zapnuté." }, { status: 400 });
  const active = body.active;
  const days = Array.isArray(body?.days) ? [...new Set(body.days.map(Number))].sort((a, b) => a - b) : [];
  if (days.length < 1 || days.length > 10 || days.some(day => !Number.isInteger(day) || day < -90 || day > 365)) {
    return NextResponse.json({ error: "Zadejte 1 až 10 celých dnů v rozmezí -90 až 365." }, { status: 400 });
  }
  const templates = body?.templates as Record<string, { subject?: unknown; body?: unknown; reply_to?: unknown; cc?: unknown }> | undefined;
  if (!templates || stages.some(stage => typeof templates[stage]?.subject !== "string" || !templates[stage].subject || typeof templates[stage]?.body !== "string" || !templates[stage].body)) {
    return NextResponse.json({ error: "Každá fáze musí mít předmět a text e-mailu." }, { status: 400 });
  }
  const validTemplates = templates as Record<ReminderStage, { subject: string; body: string; reply_to?: unknown; cc?: unknown }>;

  if (stages.some(stage => validTemplates[stage].subject.trim().length > 300 || validTemplates[stage].body.trim().length > 20_000)) {
    return NextResponse.json({ error: "Předmět nebo text šablony je příliš dlouhý." }, { status: 400 });
  }
  const unsupported = [...new Set(stages.flatMap(stage => [validTemplates[stage].subject, validTemplates[stage].body].flatMap(unsupportedTemplateVariables)))];
  if (unsupported.length) return NextResponse.json({ error: `Nepodporované proměnné: ${unsupported.map(item => `{{${item}}}`).join(", ")}.` }, { status: 400 });
  const deliverySettings = Object.fromEntries(stages.map(stage => [stage, normalizeReminderDeliverySettings(validTemplates[stage].reply_to, validTemplates[stage].cc)]));
  if (stages.some(stage => !deliverySettings[stage])) {
    return NextResponse.json({ error: "Adresa pro odpověď nebo kopie e-mailu není platná. Zadejte nejvýše pět adres pro kopii." }, { status: 400 });
  }
  const normalizedTemplates = Object.fromEntries(stages.map(stage => [stage, {
    subject: validTemplates[stage].subject.trim(),
    body: validTemplates[stage].body.trim(),
    ...deliverySettings[stage],
  }])) as Record<ReminderStage, ReminderTemplateSettings>;
  if (stages.some(stage => !normalizedTemplates[stage].subject || !normalizedTemplates[stage].body)) {
    return NextResponse.json({ error: "Každá fáze musí mít předmět a text e-mailu." }, { status: 400 });
  }
  if (isDemoMode()) return NextResponse.json({ active, days, templates: normalizedTemplates, saved: true });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění měnit pravidla." }, { status: 403 });
  const org = identity.membership.organization_id;
  const { data: change, error } = await identity.service.rpc("save_default_reminder_settings", {
    target_org: org,
    new_days: days,
    template_data: normalizedTemplates,
    new_active: active,
    actor_user: identity.user.id,
  });
  if (error) return NextResponse.json({ error: "Nastavení upomínek se nepodařilo uložit. Zkontrolujte databázovou migraci." }, { status: 500 });
  return NextResponse.json({ active, days, templates: normalizedTemplates, last_change: change, saved: true });
}
