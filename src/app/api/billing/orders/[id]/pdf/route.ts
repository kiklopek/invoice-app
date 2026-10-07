import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { supplierConfiguration } from "@/lib/billing";
import { generateBillingPdf } from "@/lib/billing-pdf";
import { loadOrder } from "@/lib/billing-server";

type Context = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Výzva k platbě nebo faktura za předplatné (jen pro členy dané firmy).
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Objednávka nebyla nalezena." }, { status: 404 });
  const identity = await getRequestIdentity();
  if (!identity) return NextResponse.json({ error: "Nejste přihlášený uživatel." }, { status: 401 });
  const order = await loadOrder(id, identity.membership.organization_id);
  const supplier = supplierConfiguration();
  if (!order || !supplier) return NextResponse.json({ error: "Doklad nebyl nalezen." }, { status: 404 });
  const pdf = await generateBillingPdf(order, supplier);
  return new Response(new Uint8Array(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdf.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
