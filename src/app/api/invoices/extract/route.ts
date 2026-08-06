import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { hasExpectedDocumentSignature, MAX_DOCUMENT_BYTES } from "@/lib/document-validation";
import { buildInvoiceOcrRequest, parseInvoiceOcrResponse } from "@/lib/invoice-ocr";
import { isSameOriginMutation } from "@/lib/request-security";
import { isDemoMode } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const OCR_TIMEOUT_MS = 50_000;

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
          amount: 48750,
          currency: "CZK",
          issue_date: "2026-08-01",
          due_date: "2026-08-15",
          notes: "Údaje byly předvyplněny z dokumentu. Před uložením je zkontrolujte.",
          source: "ocr",
          file_url: path,
        },
        confidence: 0.93,
        warnings: [],
        document_kind: "issued_invoice",
        issuer_matches_organization: true,
        model: "demo",
        response_id: null,
      },
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OCR není nakonfigurované. Doplňte serverový OPENAI_API_KEY." }, { status: 503 });

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

  const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data: recentOcr, error: rateError } = await identity.service.from("invoice_uploads")
    .select("ocr_attempt_count").eq("organization_id", organizationId).eq("created_by", identity.user.id)
    .gte("created_at", hourAgo).gt("ocr_attempt_count", 0).limit(100);
  if (rateError) return NextResponse.json({ error: "Limit OCR se nepodařilo ověřit." }, { status: 500 });
  const attemptsThisHour = (recentOcr ?? []).reduce((sum, item) => sum + Number(item.ocr_attempt_count || 0), 0);
  if (attemptsThisHour >= 20) return NextResponse.json({ error: "Hodinový limit OCR byl vyčerpán. Zkuste to později." }, { status: 429 });

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

  const { data: organization, error: organizationError } = await identity.service.from("organizations")
    .select("name, ico, dic").eq("id", organizationId).single();
  if (organizationError || !organization) return fail("Firemní údaje se nepodařilo načíst.", 500, "organization_load_failed");

  const configuredModel = process.env.OPENAI_OCR_MODEL?.trim() || "";
  const model = /^[a-zA-Z0-9._-]{1,100}$/.test(configuredModel) ? configuredModel : "gpt-5.6-sol";
  const controller = new AbortController();
  const safetyIdentifier = createHash("sha256").update(identity.user.id).digest("hex");
  const timeout = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
  let providerResponse: Response;
  try {
    providerResponse = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(buildInvoiceOcrRequest({ bytes, mime: upload.expected_mime, filename: upload.original_name, organization, model, safetyIdentifier })),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (cause) {
    clearTimeout(timeout);
    return fail(cause instanceof Error && cause.name === "AbortError" ? "OCR trvalo příliš dlouho. Zkuste dokument znovu." : "OCR služba je dočasně nedostupná.", 502, cause instanceof Error && cause.name === "AbortError" ? "provider_timeout" : "provider_network_error");
  }
  clearTimeout(timeout);

  const providerBody = await providerResponse.json().catch(() => null);
  if (!providerResponse.ok) {
    const retryable = providerResponse.status === 429 || providerResponse.status >= 500;
    return fail(retryable ? "OCR služba je dočasně vytížená. Zkuste to znovu později." : "OCR služba požadavek odmítla. Zkontrolujte její konfiguraci.", retryable ? 503 : 502, `provider_http_${providerResponse.status}`);
  }
  const extraction = parseInvoiceOcrResponse(providerBody, path, model);
  if (!extraction) return fail("OCR nevrátilo použitelná strukturovaná data.", 502, "invalid_structured_output");

  const { error: completionError } = await identity.service.from("invoice_uploads").update({
    ocr_status: "succeeded",
    ocr_model: model,
    ocr_provider_response_id: extraction.response_id,
    ocr_error: null,
    ocr_completed_at: new Date().toISOString(),
  }).eq("id", upload.id).eq("ocr_status", "processing");
  if (completionError) return NextResponse.json({ error: "Výsledek OCR se nepodařilo bezpečně potvrdit." }, { status: 500 });

  return NextResponse.json({ extraction }, { headers: { "cache-control": "no-store" } });
}
