import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getRequestIdentity } from "@/lib/auth";
import { PageDataError } from "@/lib/dashboard-page-data";
import { loadReceivedInvoicesPageData } from "@/lib/partners-page-data";
import { logError } from "@/lib/structured-log";

// Schránka přijatých faktur od všech propojených partnerů.
export async function GET(request: Request) {
  try {
    const data = await loadReceivedInvoicesPageData(await getRequestIdentity());
    return NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PageDataError) return NextResponse.json({ error: error.message }, { status: error.status });
    logError("Přijaté faktury od partnerů se nepodařilo načíst", error);
    return apiError(request, "Přijaté faktury se nepodařilo načíst.", 500, "received_invoices_failed");
  }
}
