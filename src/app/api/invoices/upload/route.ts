import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { documentTypes, validateDocumentMetadata } from "@/lib/document-validation";
import { isSameOriginMutation } from "@/lib/request-security";
import { isDemoMode } from "@/lib/supabase-server";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { name?: unknown; mime?: unknown; size?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 255) : "";
  const mime = typeof body?.mime === "string" ? body.mime : "";
  const size = Number(body?.size);
  const validationError = validateDocumentMetadata(mime, size);
  if (!name || validationError) return NextResponse.json({ error: validationError ?? "Soubor nemá platný název." }, { status: 400 });
  const extension = documentTypes.get(mime)!;

  if (isDemoMode()) return NextResponse.json({ path: `demo/${crypto.randomUUID()}.${extension}`, token: null, demo: true }, { status: 201 });

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění nahrávat faktury." }, { status: 403 });

  const organizationId = identity.membership.organization_id;
  const path = `${organizationId}/${new Date().getUTCFullYear()}/${crypto.randomUUID()}.${extension}`;
  const { data: signed, error: signError } = await identity.service.storage.from("invoice-documents").createSignedUploadUrl(path);
  if (signError || !signed?.token) return NextResponse.json({ error: "Nahrávání dokumentu se nepodařilo připravit." }, { status: 500 });

  const { error: recordError } = await identity.service.from("invoice_uploads").insert({
    organization_id: organizationId,
    path,
    original_name: name,
    expected_mime: mime,
    expected_size: size,
    created_by: identity.user.id,
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  });
  if (recordError) return NextResponse.json({ error: "Nahrávání dokumentu se nepodařilo připravit." }, { status: 500 });
  return NextResponse.json({ path, token: signed.token, demo: false }, { status: 201 });
}

