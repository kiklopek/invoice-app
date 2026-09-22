import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { hasExpectedDocumentSignature, MAX_DOCUMENT_BYTES } from "@/lib/document-validation";
import { isOcrHourlyQuotaExceeded, parseInvoiceText, type InvoiceOcrResult } from "@/lib/invoice-ocr";
import { extractInvoiceDocumentText, LocalOcrError } from "@/lib/invoice-ocr-server";
import { extractInvoiceWithGemini, GeminiOcrError } from "@/lib/invoice-ocr-gemini";
import { parseConfidenceThreshold, reconcileExtractions } from "@/lib/invoice-ocr-reconcile";
import { isSameOriginMutation } from "@/lib/request-security";
import { normalizeCounterpartyIco, resolveReminderPolicyPreference } from "@/lib/counterparty-reminder-preferences";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { path?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path : "";
  if (!path || path.length > 500) return NextResponse.json({ error: "Chybí platná cesta dokumentu." }, { status: 400 });

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění vytěžovat dokumenty." }, { status: 403 });
  const organizationId = identity.membership.organization_id;
  if (!path.startsWith(`${organizationId}/`)) return NextResponse.json({ error: "Dokument nepatří do této organizace." }, { status: 403 });

  const { data: upload, error: uploadError } = await identity.service.from("invoice_uploads")
    .select("id, original_name, expected_mime, expected_size, status, expires_at")
    .eq("organization_id", organizationId).eq("path", path).eq("created_by", identity.user.id).maybeSingle();
  if (uploadError) {
    logError("Nahraný dokument pro OCR se nepodařilo načíst", uploadError);
    return apiError(request, "Dokument se nepodařilo načíst.", 500, "ocr_upload_read_failed");
  }
  if (!upload || upload.status !== "verified" || upload.expires_at < new Date().toISOString()) {
    return NextResponse.json({ error: "Dokument není bezpečně ověřený nebo jeho nahrávání vypršelo." }, { status: 410 });
  }

  const { data: organization, error: organizationError } = await identity.service.from("organizations")
    .select("name, ico, dic, ocr_hourly_limit").eq("id", organizationId).single();
  if (organizationError || !organization) {
    logError("Firemní údaje pro OCR se nepodařilo načíst", organizationError);
    return apiError(request, "Firemní údaje se nepodařilo načíst.", 500, "ocr_company_read_failed");
  }

  if (organization.ocr_hourly_limit !== null) {
    const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const { data: recentOcr, error: rateError } = await identity.service.from("invoice_uploads")
      .select("ocr_attempt_count").eq("organization_id", organizationId).eq("created_by", identity.user.id)
      .gte("created_at", hourAgo).gt("ocr_attempt_count", 0).limit(100);
    if (rateError) {
      logError("Limit OCR se nepodařilo ověřit", rateError);
      return apiError(request, "Limit OCR se nepodařilo ověřit.", 500, "ocr_rate_check_failed");
    }
    const attemptsThisHour = (recentOcr ?? []).reduce((sum, item) => sum + Number(item.ocr_attempt_count || 0), 0);
    if (isOcrHourlyQuotaExceeded(organization.ocr_hourly_limit, attemptsThisHour)) return NextResponse.json({ error: "Hodinový limit OCR byl vyčerpán. Zkuste to později." }, { status: 429 });
  }

  const { data: claimed, error: claimError } = await identity.service.rpc("claim_invoice_ocr", {
    target_upload_id: upload.id,
    target_user_id: identity.user.id,
  });
  if (claimError) {
    logError("Převzetí dokumentu k OCR selhalo", claimError);
    return apiError(request, "Načítání dokumentů není momentálně dostupné. Zkuste to prosím znovu za chvíli.", 503, "ocr_claim_failed");
  }
  if (!claimed) return NextResponse.json({ error: "Dokument se už zpracovává nebo vyčerpal povolené pokusy." }, { status: 409 });

  const fail = async (message: string, status: number, storedError: string) => {
    await identity.service.from("invoice_uploads").update({
      ocr_status: "failed",
      ocr_error: storedError.slice(0, 500),
      ocr_completed_at: new Date().toISOString(),
    }).eq("id", upload.id).eq("ocr_status", "processing");
    // 5xx znamená, že uživatel nemá co opravit -- dostane dohledatelné
    // číslo. U 4xx (nečitelný nebo příliš dlouhý dokument) si poradí sám.
    return status >= 500
      ? apiError(request, message, status, storedError)
      : NextResponse.json({ error: message }, { status });
  };

  const { data: blob, error: downloadError } = await identity.service.storage.from("invoice-documents").download(path);
  if (downloadError || !blob) return fail("Dokument se nepodařilo načíst z úložiště.", 500, "storage_download_failed");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length !== upload.expected_size || bytes.length > MAX_DOCUMENT_BYTES || !hasExpectedDocumentSignature(bytes, upload.expected_mime)) {
    return fail("Obsah dokumentu už neodpovídá ověřenému souboru.", 415, "document_integrity_failed");
  }

  // "gemini" and "hybrid" are opt-in only, and deliberately a separate code
  // path rather than a fallback-on-failure: silently sending a document to
  // a third party because local processing hiccuped would be exactly the
  // kind of thing nobody agreed to. See invoice-ocr-gemini.ts for the
  // GDPR/data-processor reasoning behind keeping this explicit.
  const ocrProvider = process.env.OCR_PROVIDER === "gemini" || process.env.OCR_PROVIDER === "hybrid" ? process.env.OCR_PROVIDER : "local";
  const useGemini = ocrProvider === "gemini";
  const useHybrid = ocrProvider === "hybrid";

  // Provisional default, not derived from a large measured sample (only 4
  // real invoices were available when this was written, and the local
  // parser scored 0.86 confidence on all 4 -- not enough spread to fit a
  // real threshold). Deliberately set high so hybrid mode only calls Gemini
  // when the local parser is genuinely unsure, keeping the common case
  // free/fast; override via env once more real-world outcomes are measured
  // (see invoice-ocr-reconcile.ts / the OCR upgrade plan's Fáze 2).
  const HYBRID_CONFIDENCE_THRESHOLD = parseConfidenceThreshold(process.env.OCR_HYBRID_CONFIDENCE_THRESHOLD);
  const HYBRID_REQUIRED_FIELDS = ["amount", "counterparty_ico", "vat_rate"] as const;

  const runLocal = async () => {
    // pdfjs/unpdf detaches the buffer it's given (see the comment on
    // extractInvoiceDocumentText) -- hybrid mode may still need the
    // original bytes for a second, AI call afterward, so local always gets
    // its own copy, never the shared reference.
    const documentText = await extractInvoiceDocumentText({ bytes: bytes.slice(), mime: upload.expected_mime });
    if (!documentText.text.trim()) {
      throw new LocalOcrError("empty_ocr_text", "V dokumentu se nepodařilo najít žádný čitelný text. Zkuste kvalitnější sken nebo údaje doplňte ručně.");
    }
    return parseInvoiceText({
      text: documentText.text,
      fileUrl: path,
      organization,
      ocrConfidence: documentText.averageConfidence,
      extraWarnings: documentText.warnings,
      layout: documentText.layout,
    });
  };

  let extraction: InvoiceOcrResult;
  try {
    if (useGemini) {
      extraction = await extractInvoiceWithGemini({ bytes, mime: upload.expected_mime, fileUrl: path, organization });
    } else if (useHybrid) {
      const local = await runLocal();
      const missingRequiredField = HYBRID_REQUIRED_FIELDS.some(field => !local.invoice[field]);
      const needsAiCrossCheck = local.confidence < HYBRID_CONFIDENCE_THRESHOLD || missingRequiredField;
      if (!needsAiCrossCheck) {
        extraction = local;
      } else {
        try {
          const ai = await extractInvoiceWithGemini({ bytes: bytes.slice(), mime: upload.expected_mime, fileUrl: path, organization });
          extraction = reconcileExtractions(local, ai);
        } catch (aiCause) {
          // The AI cross-check is a bonus, not a requirement -- a document
          // that already produced a real local reading must not fail
          // outright just because Gemini timed out or hit a rate limit.
          // Fall back to the local-only result, same as plain "local" mode.
          logError("Křížová kontrola OCR přes AI selhala, použije se lokální výsledek", aiCause, {
            upload_id: upload.id,
            // Text chyby doplní logError sám do pole "error"; klíč "message"
            // by naopak přepsal popis výše.
            code: aiCause instanceof GeminiOcrError ? aiCause.code : "unexpected",
          });
          extraction = local;
        }
      }
    } else {
      extraction = await runLocal();
    }
  } catch (cause) {
    logError("OCR zpracování dokumentu selhalo", cause, {
      upload_id: upload.id,
      mime: upload.expected_mime,
      provider: ocrProvider,
      code: cause instanceof LocalOcrError ? cause.code : cause instanceof GeminiOcrError ? cause.code : "unexpected",
    });
    if (cause instanceof LocalOcrError) {
      const status = cause.code === "pdf_too_long" || cause.code === "scan_too_long" ? 422 : cause.code === "timeout" ? 504 : 422;
      return fail(cause.message, status, `local_${cause.code}`);
    }
    if (cause instanceof GeminiOcrError) {
      const status = cause.code === "rate_limited" ? 429 : cause.code === "not_configured" || cause.code === "invalid_key_format" ? 503 : cause.code === "timeout" ? 504 : 422;
      return fail(cause.message, status, `gemini_${cause.code}`);
    }
    return fail(useGemini ? "AI OCR se nepodařilo zpracovat. Zkuste to znovu nebo údaje doplňte ručně." : "Dokument se nepodařilo lokálně zpracovat. Zkuste jej znovu nebo údaje doplňte ručně.", 500, useGemini ? "gemini_failed" : "local_ocr_failed");
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
    return fail("Kategorii upomínek podle IČO se nepodařilo načíst. Zkuste to prosím znovu za chvíli.", 503, "reminder_preference_load_failed");
  }
  const reminderPolicyAssignment = resolveReminderPolicyPreference({
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
    ocr_model: extraction.model,
    ocr_provider_response_id: extraction.response_id,
    ocr_field_sources: extraction.field_sources,
    ocr_money_snapshot: extraction.invoice.money_evidence ?? null,
    ocr_error: null,
    ocr_completed_at: new Date().toISOString(),
  }).eq("id", upload.id).eq("ocr_status", "processing");
  if (completionError) {
    logError("Výsledek OCR se nepodařilo potvrdit", completionError, { upload_id: upload.id });
    return apiError(request, "Výsledek OCR se nepodařilo bezpečně potvrdit.", 500, "ocr_completion_failed");
  }

  return NextResponse.json({ extraction }, { headers: { "cache-control": "no-store" } });
}
