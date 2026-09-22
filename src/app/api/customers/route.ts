import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { logError } from "@/lib/structured-log";
import { getRequestIdentity } from "@/lib/auth";
import { loadCustomersPageData } from "@/lib/customers-page-data";
import { PageDataError } from "@/lib/dashboard-page-data";
import { createExcelWorkbook, excelDate, excelResponse } from "@/lib/excel-export";

export async function GET(request: Request) {
  const identity = await getRequestIdentity();
  try {
    const data = await loadCustomersPageData(identity);
    if (new URL(request.url).searchParams.get("format") === "xlsx") {
      const moneyFormat = "#,##0.00";
      const bytes = await createExcelWorkbook("Zákazníci", [
        { header: "Název", key: "name", width: 32 },
        { header: "IČO", key: "ico", width: 14 },
        { header: "DIČ", key: "dic", width: 16 },
        { header: "E-mail", key: "email", width: 28 },
        { header: "Telefon", key: "phone", width: 16 },
        { header: "Celkem fakturováno", key: "total", width: 19, numberFormat: moneyFormat },
        { header: "Neuhrazeno", key: "outstanding", width: 16, numberFormat: moneyFormat },
        { header: "Po splatnosti", key: "overdue", width: 16, numberFormat: moneyFormat },
        { header: "Kategorie upomínek", key: "reminderPolicy", width: 20 },
        { header: "Poslední faktura", key: "lastInvoice", width: 16, numberFormat: "dd.mm.yyyy" },
      ], data.customers.map((customer) => ({
        name: customer.name,
        ico: customer.ico,
        dic: customer.dic,
        email: customer.email,
        phone: customer.phone,
        total: customer.total_invoiced,
        outstanding: customer.outstanding,
        overdue: customer.overdue_amount,
        reminderPolicy: customer.reminder_policy_name ?? "nepřiřazeno",
        lastInvoice: excelDate(customer.last_invoice_date),
      })));
      return excelResponse(bytes, "zakaznici.xlsx");
    }
    return NextResponse.json(data);
  } catch (cause) {
    if (cause instanceof PageDataError) return NextResponse.json({ error: cause.message }, { status: cause.status });
    logError("Zákazníky se nepodařilo načíst", cause);
    return apiError(request, "Zákazníky se nepodařilo načíst. Zkuste to prosím znovu za chvíli.", 500, "customers_read_failed");
  }
}
