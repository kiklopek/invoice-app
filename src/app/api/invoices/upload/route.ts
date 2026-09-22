import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { documentTypes, validateDocumentMetadata } from "@/lib/document-validation";
import { isSameOriginMutation } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { name?: unknown; mime?: unknown; size?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 255) : "";
  const mime = typeof body?.mime === "string" ? body.mime : "";
  const size = Number(body?.size);
  const validationError = validateDocumentMetadata(mime, size);
  if (!name || validationError) return NextResponse.json({ error: validationError ?? "Soubor nemá platný název." }, { status: 400 });
  const extension = documentTypes.get(mime)!;

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění nahrávat faktury." }, { status: 403 });

  const organizationId = identity.membership.organization_id;
  const path = `${organizationId}/${new Date().getUTCFullYear()}/${crypto.randomUUID()}.${extension}`;
  const { data: signed, error: signError } = await identity.service.storage.from("invoice-documents").createSignedUploadUrl(path);
  if (signError || !signed?.token) {
    // Bez názvu souboru: ten může nést jméno odběratele i číslo faktury.
    logError("Podepsaný odkaz pro nahrání dokumentu se nepodařilo vytvořit", signError);
    return apiError(request, "Nahrávání dokumentu se nepodařilo připravit.", 500, "upload_sign_failed");
  }

  const { error: recordError } = await identity.service.from("invoice_uploads").insert({
    organization_id: organizationId,
    path,
    original_name: name,
    expected_mime: mime,
    expected_size: size,
    created_by: identity.user.id,
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  });
  if (recordError) {
    logError("Záznam o nahrávaném dokumentu se nepodařilo založit", recordError);
    return apiError(request, "Nahrávání dokumentu se nepodařilo připravit.", 500, "upload_record_failed");
  }
  return NextResponse.json({ path, token: signed.token }, { status: 201 });
}

