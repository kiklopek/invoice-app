import { detectLogoType, LOGO_BUCKET, logoObjectPath } from "@/lib/company-logo-file";
import { createServiceClient } from "@/lib/supabase-server";

type Context = { params: Promise<{ organizationId: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Veřejné logo firmy: zobrazuje se v aplikaci a v e-mailech s upomínkami,
// které čtou odběratelé bez přihlášení. Vrací jen ověřený obrázek, nikdy
// nic jiného (typ se znovu kontroluje podle obsahu).
export async function GET(_request: Request, { params }: Context) {
  const { organizationId } = await params;
  if (!UUID_RE.test(organizationId)) return new Response("Not found", { status: 404 });
  const { data, error } = await createServiceClient().storage.from(LOGO_BUCKET).download(logoObjectPath(organizationId));
  if (error || !data) return new Response("Not found", { status: 404 });
  const bytes = new Uint8Array(await data.arrayBuffer());
  const type = detectLogoType(bytes);
  if (!type) return new Response("Not found", { status: 404 });
  return new Response(bytes, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
