import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { canViewFinancialInsights } from "@/lib/role-access";

type Context = { params: Promise<{ id: string }> };

// The original document used to be reachable only through a signed URL minted
// while the page was being rendered and embedded straight into the markup.
// Those URLs live for five minutes, so anyone who read the invoice before
// clicking "Otevřít dokument" followed a dead link -- and when the signing call
// failed outright the button was not rendered at all, which looked like the
// invoice simply had no document. Minting the URL here, at click time, removes
// both failure modes: the link in the page is a stable route that can sit open
// for as long as the user likes.
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  if (!canViewFinancialInsights(identity.membership.role)) {
    return NextResponse.json({ error: "Nemáte oprávnění dokument zobrazit." }, { status: 403 });
  }

  const { data: invoice, error } = await identity.service.from("invoices").select("file_url")
    .eq("id", id).eq("organization_id", identity.membership.organization_id).maybeSingle();
  if (error) return NextResponse.json({ error: "Fakturu se nepodařilo načíst." }, { status: 500 });
  if (!invoice) return NextResponse.json({ error: "Faktura nebyla nalezena." }, { status: 404 });
  if (!invoice.file_url) {
    return NextResponse.json({ error: "K této faktuře není přiložen dokument." }, { status: 404 });
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  const { data: signed, error: signError } = await identity.service.storage
    .from("invoice-documents")
    .createSignedUrl(invoice.file_url, 60, download ? { download: true } : undefined);
  if (signError || !signed?.signedUrl) {
    return NextResponse.json({ error: "Dokument se nepodařilo otevřít." }, { status: 502 });
  }

  // 302 rather than 307: this is a plain GET hand-off to storage, and the short
  // lifetime is fine now that the URL is only ever used immediately.
  return NextResponse.redirect(signed.signedUrl, 302);
}
