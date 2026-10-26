import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { parseInvoiceListQuery } from "@/lib/invoice-list-query";
import { loadInvoiceListTotals } from "@/lib/invoice-list-totals";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";

export async function GET(request: Request) {
  const query = parseInvoiceListQuery(new URL(request.url).searchParams);
  if (!query)
    return NextResponse.json(
      { error: "Neplatné filtry faktur." },
      { status: 400 },
    );
  try {
    const identity = await getRequestIdentity();
    if (!identity)
      return NextResponse.json(
        { error: "Nejste přihlášený uživatel." },
        { status: 401 },
      );
    return NextResponse.json(await loadInvoiceListTotals(identity, query), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    logError("Součet filtrovaných faktur se nepodařilo načíst", error);
    return apiError(
      request,
      "Součet faktur se nepodařilo načíst.",
      500,
      "invoice_totals_failed",
    );
  }
}
