import type { Invoice } from "@/types/invoice";
import { buildInvoiceReport } from "@/lib/report-query";
import {
  DEFAULT_REPORT_OPTIONS,
  type FinancialReportModel,
  type FinancialReportSnapshot,
} from "@/lib/financial-report";
export function financialReportFixture(count = 6): FinancialReportModel {
  const rows = Array.from({ length: count }, (_, i) => {
    const net = 1000 + i * 10,
      rate = i % 4 ? 21 : 12,
      gross = Math.round(net * (1 + rate / 100) * 100) / 100,
      paid = i % 3 === 0 ? gross : i % 3 === 1 ? 100 : 0;
    return {
      id: `550e8400-e29b-41d4-a716-${String(i).padStart(12, "0")}`,
      invoice_number: `FV-2026-${String(i + 1).padStart(5, "0")}`,
      counterparty_name: `Odběratel ${(i % 3) + 1} s.r.o.`,
      amount_without_vat: net,
      vat_rate: rate,
      amount: gross,
      paid_amount: paid,
      remaining_amount: gross - paid,
      currency: "CZK",
      issue_date: `2026-${String((i % 6) + 1).padStart(2, "0")}-05`,
      due_date: "2026-07-19",
      paid_at: i % 3 === 0 ? "2026-07-15T12:00:00Z" : null,
      status: i % 3 === 0 ? ("paid" as const) : ("overdue" as const),
      reminders_sent: 1,
    };
  });
  const report = buildInvoiceReport(
    rows as unknown as Invoice[],
    "CZK",
    "2026-10-25",
  );
  const imports = Array.from({ length: 3 }, (_, i) => ({
    id: String(i),
    filename: `Výpis-červen-${i + 1}.gpc`,
    committed_at: `2026-0${i + 5}-20T12:00:00Z`,
    accepted_count: 10,
    ignored_count: 1,
    error_count: 0,
    auto_matched: 7,
    needs_review: 3,
  }));
  const customers = [...new Set(rows.map((r) => r.counterparty_name))]
    .map((name) => {
      const selected = rows.filter((r) => r.counterparty_name === name);
      return {
        name,
        invoiced: selected.reduce((s, r) => s + r.amount, 0),
        paid: selected.reduce((s, r) => s + r.paid_amount, 0),
        count: selected.length,
      };
    })
    .sort((a, b) => b.invoiced - a.invoiced);
  const snapshot: FinancialReportSnapshot = {
    company: {
      name: "Ukázková firma s.r.o.",
      ico: "12345678",
      dic: "CZ12345678",
      address: "Praha, Dlouhá 10, 110 00",
    },
    generated_at: "2026-10-25T13:32:00Z",
    as_of: "2026-10-25",
    report,
    invoices: rows,
    customers,
    imports: count ? imports : [],
    payments: {
      totals: {
        imports: count ? 3 : 0,
        accepted: count ? 30 : 0,
        auto_matched: count ? 21 : 0,
        needs_review: count ? 9 : 0,
        unmatched_payments: 0,
        unacknowledged_mismatch_imports: 0,
      },
      monthly: count
        ? imports.map((r, i) => ({
            key: `2026-0${i + 5}`,
            imports: 1,
            accepted: r.accepted_count,
            auto_matched: r.auto_matched,
            needs_review: r.needs_review,
          }))
        : [],
      recent_imports: count ? imports : [],
    },
  };
  return {
    snapshot,
    query: {
      from: "2026-01-01",
      to: "2026-10-25",
      dateBasis: "issue_date",
      currency: "CZK",
      status: null,
      customer: null,
    },
    options: {
      ...DEFAULT_REPORT_OPTIONS,
      sections: [...DEFAULT_REPORT_OPTIONS.sections],
    },
  };
}
