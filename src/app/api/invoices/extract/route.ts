import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { hasExpectedDocumentSignature, MAX_DOCUMENT_BYTES } from "@/lib/document-validation";
import { isOcrHourlyQuotaExceeded, LOCAL_OCR_MODEL, parseInvoiceText } from "@/lib/invoice-ocr";
import { extractInvoiceDocumentText, LocalOcrError } from "@/lib/invoice-ocr-server";
import { isSameOriginMutation } from "@/lib/request-security";
import { isDemoMode } from "@/lib/supabase-server";
import { normalizeCounterpartyIco, resolveOcrReminderPolicy } from "@/lib/counterparty-reminder-preferences";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { path?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path : "";
  if (!path || path.length > 500) return NextResponse.json({ error: "Chybí platná cesta dokumentu." }, { status: 400 });

  if (isDemoMode()) {
    return NextResponse.json({
      extraction: {
        invoice: {
          invoice_number: "FV-2026-084",
          counterparty_name: "Stavby Novák s.r.o.",
          counterparty_ico: "12345678",
          counterparty_dic: "CZ12345678",
          counterparty_email: "fakturace@stavbynovak.cz",
          variable_symbol: "2026084",
          amount_without_vat: 40289.26,
          vat_rate: 21,
          amount: 48750,
          currency: "CZK",
          issue_date: "2026-08-01",
          due_date: "2026-08-15",
          notes: "Údaje byly předvyplněny z dokumentu. Před uložením je zkontrolujte.",
          source: "ocr",
          file_url: path,
          reminder_policy_id: "00000000-0000-4000-8000-000000000001",
        },
        field_sources: {},
        confidence: 0.93,
        warnings: [],
        document_kind: "issued_invoice",
        issuer_matches_organization: true,
        reminder_policy_assignment: {
          status: "default",
          counterparty_ico: "12345678",
          policy_id: "00000000-0000-4000-8000-000000000001",
          policy_name: "Standardní",
        },
        model: "demo",
        response_id: null,
      },
    });
  }

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění vytěžovat dokumenty." }, { status: 403 });
  const organizationId = identity.membership.organization_id;
  if (!path.startsWith(`${organizationId}/`)) return NextResponse.json({ error: "Dokument nepatří do této organizace." }, { status: 403 });

  const { data: upload, error: uploadError } = await identity.service.from("invoice_uploads")
    .select("id, original_name, expected_mime, expected_size, status, expires_at")
    .eq("organization_id", organizationId).eq("path", path).eq("created_by", identity.user.id).maybeSingle();
  if (uploadError) return NextResponse.json({ error: "Dokument se nepodařilo načíst." }, { status: 500 });
  if (!upload || upload.status !== "verified" || upload.expires_at < new Date().toISOString()) {
    return NextResponse.json({ error: "Dokument není bezpečně ověřený nebo jeho nahrávání vypršelo." }, { status: 410 });
  }

  const { data: organization, error: organizationError } = await identity.service.from("organizations")
    .select("name, ico, dic, ocr_hourly_limit").eq("id", organizationId).single();
  if (organizationError || !organization) return NextResponse.json({ error: "Firemní údaje se nepodařilo načíst." }, { status: 500 });

  if (organization.ocr_hourly_limit !== null) {
    const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const { data: recentOcr, error: rateError } = await identity.service.from("invoice_uploads")
      .select("ocr_attempt_count").eq("organization_id", organizationId).eq("created_by", identity.user.id)
      .gte("created_at", hourAgo).gt("ocr_attempt_count", 0).limit(100);
    if (rateError) return NextResponse.json({ error: "Limit OCR se nepodařilo ověřit." }, { status: 500 });
    const attemptsThisHour = (recentOcr ?? []).reduce((sum, item) => sum + Number(item.ocr_attempt_count || 0), 0);
    if (isOcrHourlyQuotaExceeded(organization.ocr_hourly_limit, attemptsThisHour)) return NextResponse.json({ error: "Hodinový limit OCR byl vyčerpán. Zkuste to později." }, { status: 429 });
  }

  const { data: claimed, error: claimError } = await identity.service.rpc("claim_invoice_ocr", {
    target_upload_id: upload.id,
    target_user_id: identity.user.id,
  });
  if (claimError) return NextResponse.json({ error: "OCR databázová migrace není připravená." }, { status: 503 });
  if (!claimed) return NextResponse.json({ error: "Dokument se už zpracovává nebo vyčerpal povolené pokusy." }, { status: 409 });

  const fail = async (message: string, status: number, storedError: string) => {
    await identity.service.from("invoice_uploads").update({
      ocr_status: "failed",
      ocr_error: storedError.slice(0, 500),
      ocr_completed_at: new Date().toISOString(),
    }).eq("id", upload.id).eq("ocr_status", "processing");
    return NextResponse.json({ error: message }, { status });
  };

  const { data: blob, error: downloadError } = await identity.service.storage.from("invoice-documents").download(path);
  if (downloadError || !blob) return fail("Dokument se nepodařilo načíst z úložiště.", 500, "storage_download_failed");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length !== upload.expected_size || bytes.length > MAX_DOCUMENT_BYTES || !hasExpectedDocumentSignature(bytes, upload.expected_mime)) {
    return fail("Obsah dokumentu už neodpovídá ověřenému souboru.", 415, "document_integrity_failed");
  }

  let extraction;
  try {
    const documentText = await extractInvoiceDocumentText({ bytes, mime: upload.expected_mime });
    if (!documentText.text.trim()) {
      return fail("V dokumentu se nepodařilo najít žádný čitelný text. Zkuste kvalitnější sken nebo údaje doplňte ručně.", 422, "empty_ocr_text");
    }
    extraction = parseInvoiceText({
      text: documentText.text,
      fileUrl: path,
      organization,
      ocrConfidence: documentText.averageConfidence,
      extraWarnings: documentText.warnings,
      layout: documentText.layout,
    });
  } catch (cause) {
    console.error("[invoice-ocr] extraction failed", {
      uploadId: upload.id,
      mime: upload.expected_mime,
      code: cause instanceof LocalOcrError ? cause.code : "unexpected",
      message: cause instanceof Error ? cause.message : String(cause),
    });
    if (cause instanceof LocalOcrError) {
      const status = cause.code === "pdf_too_long" || cause.code === "scan_too_long" ? 422 : cause.code === "timeout" ? 504 : 422;
      return fail(cause.message, status, `local_${cause.code}`);
    }
    return fail("Dokument se nepodařilo lokálně zpracovat. Zkuste jej znovu nebo údaje doplňte ručně.", 500, "local_ocr_failed");
  }

  const normalizedIco = normalizeCounterpartyIco(extraction.invoice.counterparty_ico);
  const preferencePromise = normalizedIco
    ? identity.service.from("counterparty_reminder_preferences").select("reminder_policy_id")
        .eq("organization_id", organizationId).eq("counterparty_ico", normalizedIco).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const policiesPromise = identity.service.from("reminder_policies")
    .select("id, name, is_default").eq("organization_id", organizationId)
    .is("archived_at", null).order("is_default", { ascending: false });
  const [{ data: preference, error: preferenceError }, { data: policies, error: policiesError }] = await Promise.all([
    preferencePromise,
    policiesPromise,
  ]);
  if (preferenceError || policiesError) {
    return fail("Kategorii upomínek podle IČO se nepodařilo načíst. Zkontrolujte databázovou migraci.", 503, "reminder_preference_load_failed");
  }
  const reminderPolicyAssignment = resolveOcrReminderPolicy({
    counterpartyIco: normalizedIco,
    preferredPolicyId: preference?.reminder_policy_id,
    policies: policies ?? [],
  });
  if (!reminderPolicyAssignment) {
    return fail("Nejdříve nastavte alespoň jednu kategorii upomínek.", 409, "reminder_policy_missing");
  }
  extraction = {
    ...extraction,
    invoice: { ...extraction.invoice, reminder_policy_id: reminderPolicyAssignment.policy_id },
    reminder_policy_assignment: reminderPolicyAssignment,
  };

  const { error: completionError } = await identity.service.from("invoice_uploads").update({
    ocr_status: "succeeded",
    ocr_model: LOCAL_OCR_MODEL,
    ocr_provider_response_id: null,
    ocr_field_sources: extraction.field_sources,
    ocr_error: null,
    ocr_completed_at: new Date().toISOString(),
  }).eq("id", upload.id).eq("ocr_status", "processing");
  if (completionError) return NextResponse.json({ error: "Výsledek OCR se nepodařilo bezpečně potvrdit." }, { status: 500 });

  return NextResponse.json({ extraction }, { headers: { "cache-control": "no-store" } });
}
