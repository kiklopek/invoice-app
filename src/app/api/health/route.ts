import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { isDemoMode } from "@/lib/supabase-server";
import { todayInTimeZone } from "@/lib/reminders";

const pending = (label: string, detail: string) => ({ label, ready: false, detail });

export async function GET() {
  if (isDemoMode()) return NextResponse.json({ mode: "demo", services: {
    database: pending("Databáze a přihlášení", "Demo režim · připojte produkční Supabase"),
    storage: pending("Úložiště dokumentů", "Demo režim · soubory se trvale neukládají"),
    email: pending("E-mailové upomínky", "Připojte Resend a ověřenou doménu"),
    delivery: pending("Doručení e-mailů", "Připojte podepsaný Resend webhook"),
    cron: pending("Denní automat", "Nastavte produkční CRON_SECRET"),
    payments: pending("Párování bankovních plateb", "Demo režim · produkční historie se neukládá"),
    ocr: pending("OCR dokumentů", "Demo režim · v produkci běží lokální OCR"),
  } });

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  const today = todayInTimeZone();
  const [{ data: bucket, error: bucketError }, { error: auditSchemaError }, { error: accessAuditSchemaError }, { error: paymentSchemaError }, { error: ocrSchemaError }, { error: deliverySchemaError }, { error: automationSchemaError }, { error: settingsAuditSchemaError }, { error: invoiceListSchemaError }, { error: reportSchemaError }, { error: dashboardSchemaError }] = await Promise.all([
    identity.service.storage.getBucket("invoice-documents"),
    identity.service.from("invoice_events").select("id").limit(1),
    identity.service.from("organization_member_events").select("id, actor_email, created_at").limit(1),
    identity.service.from("bank_payments").select("id, unmatched_at, unmatched_by").limit(1),
    identity.service.from("invoice_uploads").select("id, ocr_status").limit(1),
    identity.service.from("provider_webhook_events").select("event_id").limit(1),
    identity.service.from("reminder_automation_runs").select("id, status, trigger_source, triggered_by_email, started_at").limit(1),
    identity.service.from("reminder_settings_events").select("id, actor_email, created_at").limit(1),
    identity.service.rpc("list_invoices_page", { target_org: identity.membership.organization_id, actor_user: identity.user.id, page_number: 1, page_size: 1 }),
    identity.service.rpc("invoice_report_summary", { target_org: identity.membership.organization_id, actor_user: identity.user.id, report_from: `${today.slice(0, 4)}-01-01`, report_to: today, date_basis: "issue_date", currency_filter: "CZK", as_of_date: today }),
    identity.service.rpc("dashboard_summary", { target_org: identity.membership.organization_id, actor_user: identity.user.id }),
  ]);
  const emailReady = Boolean(process.env.RESEND_API_KEY && process.env.REMINDER_EMAIL_FROM);
  const deliveryReady = Boolean(process.env.RESEND_WEBHOOK_SECRET && !deliverySchemaError);
  const ocrReady = !ocrSchemaError;
  const cronReady = Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 16 && !automationSchemaError);
  return NextResponse.json({ mode: "production", services: {
    database: { label: "Databáze a přihlášení", ready: !auditSchemaError && !accessAuditSchemaError && !paymentSchemaError && !ocrSchemaError && !deliverySchemaError && !automationSchemaError && !settingsAuditSchemaError && !invoiceListSchemaError && !reportSchemaError && !dashboardSchemaError, detail: auditSchemaError || accessAuditSchemaError || paymentSchemaError || ocrSchemaError || deliverySchemaError || automationSchemaError || settingsAuditSchemaError || invoiceListSchemaError || reportSchemaError || dashboardSchemaError ? "Supabase je připojený, ale chybí poslední databázová migrace" : "Supabase, členství, audit přístupů, platby, OCR, doručení, monitoring, historie nastavení, stránkování, reporty i dashboard jsou připravené" },
    storage: { label: "Úložiště dokumentů", ready: Boolean(bucket && !bucket.public && !bucketError), detail: bucket && !bucket.public && !bucketError ? "Soukromý bucket je dostupný" : "Soukromý bucket invoice-documents není připravený" },
    email: { label: "E-mailové upomínky", ready: emailReady, detail: emailReady ? "Resend konfigurace je přítomná" : "Chybí Resend klíč nebo adresa odesílatele" },
    delivery: { label: "Doručení e-mailů", ready: deliveryReady, detail: deliveryReady ? "Podepsané události doručení jsou připravené" : "Chybí Resend webhook secret nebo databázová migrace" },
    cron: { label: "Denní automat", ready: cronReady, detail: cronReady ? "Tajný klíč a evidence běhů jsou připravené" : "Chybí bezpečný CRON_SECRET nebo migrace evidence běhů" },
    payments: { label: "Párování bankovních plateb", ready: !paymentSchemaError, detail: paymentSchemaError ? "Chybí migrace bankovních plateb" : "Bezpečný import a přesné párování je připravené" },
    ocr: { label: "OCR dokumentů", ready: ocrReady, detail: ocrReady ? "Lokální OCR dokumentů je připravené (local-tesseract-v1)" : "Chybí OCR databázová migrace" },
  } });
}
