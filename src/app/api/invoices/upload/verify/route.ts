import { NextResponse } from "next/server";
import { canManageInvoices, getRequestIdentity } from "@/lib/auth";
import { hasExpectedDocumentSignature, MAX_DOCUMENT_BYTES } from "@/lib/document-validation";
import { isSameOriginMutation } from "@/lib/request-security";
import { isDemoMode } from "@/lib/supabase-server";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Požadavek pochází z nepovoleného webu." }, { status: 403 });
  const body = await request.json().catch(() => null) as { path?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path : "";
  if (!path) return NextResponse.json({ error: "Chybí cesta dokumentu." }, { status: 400 });
  if (isDemoMode()) return NextResponse.json({ path, verified: true });

  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canManageInvoices(identity.membership.role)) return NextResponse.json({ error: "Nemáte oprávnění ověřovat dokumenty." }, { status: 403 });
  const organizationId = identity.membership.organization_id;
  if (!path.startsWith(`${organizationId}/`)) return NextResponse.json({ error: "Dokument nepatří do této organizace." }, { status: 403 });

  const { data: upload } = await identity.service.from("invoice_uploads").select("id, expected_mime, expected_size, status, expires_at")
    .eq("organization_id", organizationId).eq("path", path).eq("created_by", identity.user.id).maybeSingle();
  if (!upload || upload.status !== "pending" || upload.expires_at < new Date().toISOString()) {
    return NextResponse.json({ error: "Platnost nahrávání vypršela. Vyberte dokument znovu." }, { status: 410 });
  }

  const { data: blob, error: downloadError } = await identity.service.storage.from("invoice-documents").download(path);
  if (downloadError || !blob) return NextResponse.json({ error: "Nahraný dokument se nepodařilo ověřit." }, { status: 400 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const valid = bytes.length === upload.expected_size && bytes.length <= MAX_DOCUMENT_BYTES && hasExpectedDocumentSignature(bytes, upload.expected_mime);
  if (!valid) {
    await identity.service.storage.from("invoice-documents").remove([path]);
    await identity.service.from("invoice_uploads").delete().eq("id", upload.id);
    return NextResponse.json({ error: "Obsah nahraného souboru neodpovídá jeho typu nebo velikosti." }, { status: 415 });
  }

  const { error } = await identity.service.from("invoice_uploads").update({ status: "verified", verified_at: new Date().toISOString() })
    .eq("id", upload.id).eq("status", "pending");
  if (error) return NextResponse.json({ error: "Dokument se nepodařilo potvrdit." }, { status: 500 });
  return NextResponse.json({ path, verified: true });
}

