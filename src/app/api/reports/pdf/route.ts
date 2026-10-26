import { apiError } from "@/lib/api-response";
import { NextResponse } from "next/server";
import { getRequestIdentity } from "@/lib/auth";
import { canViewFinancialInsights } from "@/lib/role-access";
import { isSameOriginMutation } from "@/lib/request-security";
import { parseReportQuery } from "@/lib/report-query";
import { parseReportOptions } from "@/lib/financial-report";
import { loadFinancialReportSnapshot } from "@/lib/financial-report-server";
import { generateFinancialReport } from "@/lib/financial-report-pdf";
import { ReportLimitError } from "@/lib/financial-report-drawing";
import { PageDataError } from "@/lib/dashboard-page-data";
import { logError, requestId } from "@/lib/structured-log";
export async function POST(request: Request) {
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Nepovolený původ požadavku." },
      { status: 403 },
    );
  const identity = await getRequestIdentity();
  if (!identity)
    return NextResponse.json({ error: "Nejste přihlášeni." }, { status: 401 });
  if (!canViewFinancialInsights(identity.membership.role))
    return NextResponse.json(
      { error: "K reportům nemáte přístup." },
      { status: 403 },
    );
  let body;
  try {
    const text = await request.text();
    if (text.length > 16384) throw new Error();
    body = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: "Neplatná konfigurace reportu." },
      { status: 400 },
    );
  }
  const raw = body?.query;
  if (
    !raw ||
    ![raw.from, raw.to, raw.currency, raw.dateBasis].every(
      (v) => typeof v === "string",
    ) ||
    (raw.status !== null && typeof raw.status !== "string") ||
    (raw.customer !== null && typeof raw.customer !== "string")
  )
    return NextResponse.json(
      { error: "Zkontrolujte filtry reportu." },
      { status: 400 },
    );
  const params = new URLSearchParams({
    from: raw.from,
    to: raw.to,
    currency: raw.currency,
    date_basis: raw.dateBasis,
  });
  if (raw.status) params.set("status", raw.status);
  if (raw.customer) params.set("customer", raw.customer);
  const query = parseReportQuery(params);
  if (!query || Date.parse(query.to) - Date.parse(query.from) > 3660 * 86400000)
    return NextResponse.json(
      { error: "Vyberte platné období dlouhé nejvýše deset let." },
      { status: 400 },
    );
  let options;
  try {
    options = parseReportOptions(body.options);
  } catch {
    return NextResponse.json(
      { error: "Zkontrolujte typ a obsah reportu." },
      { status: 400 },
    );
  }
  try {
    const snapshot = await loadFinancialReportSnapshot(identity, query);
    const { bytes, pageCount } = await generateFinancialReport({
      snapshot,
      query,
      options,
    });
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="Splatno-report-${query.from}-${query.to}-${query.currency}.pdf"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-report-pages": String(pageCount),
        "x-report-generated-at": snapshot.generated_at,
      },
    });
  } catch (error) {
    if (error instanceof PageDataError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    if (error instanceof ReportLimitError)
      return NextResponse.json({ error: error.message }, { status: 413 });
    logError("Generování finančního PDF selhalo", error, { request_id: requestId(request) });
    return apiError(request, "PDF se nepodařilo připravit. Zkuste to znovu.", 500, "report_pdf_failed");
  }
}
