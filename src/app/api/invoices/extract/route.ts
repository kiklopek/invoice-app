import { NextResponse } from "next/server";
import { subscriptionBlock } from "@/lib/billing-server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { hasExpectedDocumentSignature, MAX_DOCUMENT_BYTES } from "@/lib/document-validation";
import { isOcrHourlyQuotaExceeded, needsOcrAiReview, omitUnverifiedOcrValues, parseInvoiceText, pickOcrReviewValues, type InvoiceOcrResult } from "@/lib/invoice-ocr";
import { extractInvoiceDocumentText, LocalOcrError } from "@/lib/invoice-ocr-server";
import { extractInvoiceWithGemini, GeminiOcrError } from "@/lib/invoice-ocr-gemini";
import { enrichCounterpartyFromCustomer, rejectOrganizationIdentity, validateCounterpartyWithAres } from "@/lib/invoice-ocr-registry";
import { applyOcrConsistencyChecks, mergeOcrSources, type ExactSourceReading } from "@/lib/invoice-ocr-sources";
import { isdocToExactReading, parseIsdoc } from "@/lib/invoice-isdoc";
import { spaydToExactReading } from "@/lib/invoice-qr";
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
  const subscriptionBlocked = await subscriptionBlock(identity);
  if (subscriptionBlocked) return subscriptionBlocked;
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
    .select("name, ico, dic, email, ocr_hourly_limit").eq("id", organizationId).single();
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
  const contextualMode = process.env.OCR_CONTEXTUAL_MODE === "shadow" ? "shadow" : "active";
  const useGemini = ocrProvider === "gemini";
  const useHybrid = ocrProvider === "hybrid";
  // OCR_AI_PRIMARY=true: in hybrid mode Gemini reads every document as the
  // main reader (the local parser stays the independent check). Default off,
  // because every call sends the document to a third party and costs money.
  const aiPrimary = process.env.OCR_AI_PRIMARY === "true";
  let exactReadings: ExactSourceReading[] = [];

  const runLocal = async () => {
    // pdfjs/unpdf detaches the buffer it's given (see the comment on
    // extractInvoiceDocumentText) -- hybrid mode may still need the
    // original bytes for a second, AI call afterward, so local always gets
    // its own copy, never the shared reference.
    const documentText = await extractInvoiceDocumentText({ bytes: bytes.slice(), mime: upload.expected_mime });
    if (!documentText.text.trim()) {
      throw new LocalOcrError("empty_ocr_text", "V dokumentu se nepodařilo najít žádný čitelný text. Zkuste kvalitnější sken nebo údaje doplňte ručně.");
    }
    // Přesné zdroje vložené v samotném dokumentu: ISDOC příloha a QR platba.
    const parsedIsdoc = documentText.isdoc ? parseIsdoc(documentText.isdoc.xml) : null;
    const qrReading = spaydToExactReading(documentText.qrCodes ?? []);
    exactReadings = [
      ...(parsedIsdoc && documentText.isdoc ? [isdocToExactReading(parsedIsdoc, organization, documentText.isdoc.fileName)] : []),
      ...(qrReading ? [qrReading] : []),
    ];
    if (documentText.isdoc && !parsedIsdoc) documentText.warnings.push("PDF obsahuje přílohu ISDOC, kterou se nepodařilo přečíst. Údaje byly vytěženy z obsahu dokumentu.");
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
      extraction = mergeOcrSources({ ai: await extractInvoiceWithGemini({ bytes, mime: upload.expected_mime, fileUrl: path, organization }), organization });
    } else if (useHybrid) {
      const local = await runLocal();
      const withExact = mergeOcrSources({ local, exact: exactReadings, organization });
      // A complete ISDOC already carries the whole invoice exactly -- the
      // document does not need to leave the company for an AI reading.
      const isdocComplete = exactReadings.some(reading => reading.method === "isdoc"
        && reading.values.amount && reading.values.invoice_number && reading.values.counterparty_ico);
      const needsAiCrossCheck = !isdocComplete && (aiPrimary || (contextualMode === "active"
        ? needsOcrAiReview(withExact)
        : local.confidence < 0.8 || !local.invoice.amount || !local.invoice.counterparty_ico || !local.field_sources.vat_rate));
      if (!needsAiCrossCheck) {
        extraction = withExact;
      } else {
        try {
          const ai = await extractInvoiceWithGemini({ bytes: bytes.slice(), mime: upload.expected_mime, fileUrl: path, organization });
          extraction = mergeOcrSources({ local, ai, exact: exactReadings, organization });
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
          extraction = withExact;
        }
      }
    } else {
      const local = await runLocal();
      extraction = mergeOcrSources({ local, exact: exactReadings, organization });
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

  // Always enforce the organization's own identity before any optional ARES
  // rollout logic. This prevents the supplier's IČO from reaching the form,
  // reminder preferences, or persisted OCR proposal through any provider.
  extraction = rejectOrganizationIdentity(extraction, organization);
  const registryValidated = await validateCounterpartyWithAres(extraction, identity.service);
  if (contextualMode === "active") {
    // ARES may have filled a name or DIČ -- rerun the result checks (DIČ vs
    // IČO etc.) on the final values before deciding what the form gets.
    const withCustomer = await enrichCounterpartyFromCustomer(registryValidated, identity.service, organization, organizationId);
    extraction = omitUnverifiedOcrValues(applyOcrConsistencyChecks(withCustomer, organization), organization);
  } else if (
    registryValidated.invoice.counterparty_ico !== extraction.invoice.counterparty_ico
    || registryValidated.invoice.counterparty_dic !== extraction.invoice.counterparty_dic
  ) {
    // Shadow rollout records only whether the new registry guard would have
    // changed identity. It deliberately does not log customer values.
    console.info("[invoice-ocr] shadow ARES validation would require identity review", { upload_id: upload.id });
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
    ocr_field_sources: JSON.parse(JSON.stringify(extraction.field_sources)),
    ocr_field_decisions: JSON.parse(JSON.stringify(extraction.field_decisions)),
    ocr_proposed_values: JSON.parse(JSON.stringify(pickOcrReviewValues(extraction.invoice))),
    ocr_vocabulary_version: extraction.vocabulary_version,
    ocr_money_snapshot: extraction.invoice.money_evidence ?? null,
    ocr_error: null,
    ocr_completed_at: new Date().toISOString(),
  }).eq("id", upload.id).eq("ocr_status", "processing");
  if (completionError) {
    logError("Výsledek OCR se nepodařilo potvrdit", completionError, { upload_id: upload.id });
    return apiError(request, "Výsledek OCR se nepodařilo bezpečně potvrdit.", 500, "ocr_completion_failed");
  }

  if (extraction.keyword_suggestions.length) {
    const { error: suggestionsError } = await identity.service.from("invoice_ocr_keyword_suggestions").insert(
      extraction.keyword_suggestions.map(suggestion => ({
        organization_id: organizationId,
        upload_id: upload.id,
        normalized_label: suggestion.normalized_label,
        example_label: suggestion.example_label,
        vocabulary_version: extraction.vocabulary_version,
      })),
    );
    if (suggestionsError) logError("Návrhy nových OCR popisků se nepodařilo uložit", suggestionsError, { upload_id: upload.id });
  }

  return NextResponse.json({ extraction }, { headers: { "cache-control": "no-store" } });
}
