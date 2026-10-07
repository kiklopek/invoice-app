import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getRequestIdentity } from "@/lib/auth";
import { detectLogoType, LOGO_BUCKET, logoObjectPath, logoPathFor, MAX_LOGO_BYTES } from "@/lib/company-logo-file";
import { isSameOriginMutation } from "@/lib/request-security";
import { canManageMembers } from "@/lib/role-access";
import { logError, requestId } from "@/lib/structured-log";

async function adminIdentity(request: Request) {
  if (!isSameOriginMutation(request)) return { error: apiError(request, "Požadavek pochází z nepovoleného webu.", 403, "origin_denied") };
  const identity = await getRequestIdentity();
  if (!identity) return { error: apiError(request, "Nejste přihlášený uživatel.", 401, "unauthorized") };
  if (!canManageMembers(identity.membership.role)) return { error: apiError(request, "Logo může měnit jen administrátor.", 403, "forbidden") };
  return { identity };
}

// Nahrání loga firmy (PNG, JPEG nebo WebP do 512 kB).
export async function POST(request: Request) {
  const result = await adminIdentity(request);
  if (result.error) return result.error;
  const { identity } = result;
  const form = await request.formData().catch(() => null);
  const file = form?.get("logo");
  if (!(file instanceof Blob)) return apiError(request, "Vyberte soubor s logem.", 400, "missing_file");
  if (file.size > MAX_LOGO_BYTES) return apiError(request, "Logo může mít nejvýš 512 kB.", 400, "too_large");
  const data = new Uint8Array(await file.arrayBuffer());
  const type = detectLogoType(data);
  if (!type) return apiError(request, "Logo musí být obrázek PNG, JPEG nebo WebP.", 400, "unsupported_type");

  const org = identity.membership.organization_id;
  const { error: uploadError } = await identity.service.storage
    .from(LOGO_BUCKET)
    .upload(logoObjectPath(org), data, { contentType: type, upsert: true });
  if (uploadError) {
    logError("Nahrání loga selhalo", uploadError, { request_id: requestId(request) });
    return apiError(request, "Logo se nepodařilo nahrát.", 500, "upload_failed");
  }
  const logoPath = logoPathFor(org, Date.now());
  const { error } = await identity.service.from("organizations").update({ logo_path: logoPath }).eq("id", org);
  if (error) {
    logError("Uložení loga selhalo", error, { request_id: requestId(request) });
    return apiError(request, "Logo se nepodařilo uložit.", 500, "logo_save_failed");
  }
  return NextResponse.json({ logo_path: logoPath });
}

export async function DELETE(request: Request) {
  const result = await adminIdentity(request);
  if (result.error) return result.error;
  const { identity } = result;
  const org = identity.membership.organization_id;
  const { error } = await identity.service.from("organizations").update({ logo_path: null }).eq("id", org);
  if (error) {
    logError("Odebrání loga selhalo", error, { request_id: requestId(request) });
    return apiError(request, "Logo se nepodařilo odebrat.", 500, "logo_remove_failed");
  }
  await identity.service.storage.from(LOGO_BUCKET).remove([logoObjectPath(org)]);
  return NextResponse.json({ logo_path: null });
}
