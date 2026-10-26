// Synthetic dashboard data shared by browser fixtures. Never used by application code.
export const invoices = Array.from({ length: 7 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  invoice_number: `FV-2026-${String(index + 1).padStart(4, "0")}`,
  counterparty_name: [
    "Ukázková firma s.r.o.",
    "Ateliér Sever",
    "Studio Zelená",
    "Doprava Jih",
    "Projekt Alfa",
    "Dílna Beta",
    "Obchod Gama",
  ][index],
  counterparty_email: `faktury${index}@example.invalid`,
  variable_symbol: `202600${index + 1}`,
  amount: 125000 + index * 2000,
  paid_amount: index === 2 ? 40000 : 0,
  currency: "CZK",
  status: index === 0 ? "overdue" : "pending",
  reminders_sent: index === 0 ? 2 : 0,
  due_date: `2026-10-${String(14 + index).padStart(2, "0")}`,
  next_reminder_at: `2026-10-${String(18 + index).padStart(2, "0")}T08:00:00Z`,
  created_at: `2026-10-${String(14 - index).padStart(2, "0")}T08:00:00Z`,
}));
const summary = {
  period: { from: null, to: "2026-10-17" },
  report_from: "2025-11-01",
  open_totals: { CZK: 1340000 },
  overdue_totals: { CZK: 320000 },
  paid_totals: { CZK: 1980000 },
  active_count: 25,
  overdue_count: 7,
  reminders_sent: 12,
  recent: invoices,
  upcoming: invoices.slice(0, 4),
  payments_needing_review: 4,
  ocr_pending_confirmation: 0,
  reminders_due_soon: 2,
};
export function scenarioSummary(scenario) {
  const value = structuredClone(summary);
  if (scenario === "empty")
    Object.assign(value, {
      open_totals: {},
      overdue_totals: {},
      paid_totals: {},
      active_count: 0,
      overdue_count: 0,
      reminders_sent: 0,
      recent: [],
      upcoming: [],
      payments_needing_review: 0,
      reminders_due_soon: 0,
    });
  if (scenario === "stress") {
    value.open_totals = { CZK: 999999999999.99, EUR: 888888888.88 };
    value.paid_totals = value.open_totals;
    value.overdue_totals = value.open_totals;
    value.recent = value.recent.map((invoice) => ({
      ...invoice,
      invoice_number: "FV-2026-NEOBVYKLE-DLOUHE-CISLO-1234567890",
      counterparty_name:
        "Mezinárodní stavební a obchodní společnost s velmi dlouhým názvem s.r.o.",
      counterparty_email:
        "fakturace.dlouhy.kontakt@velmidlouha-domena.example.invalid",
      amount: 999999999999.99,
    }));
  }
  value.invoice_count = scenario === "empty" ? 0 : 124;
  value.paid_invoice_count = scenario === "empty" ? 0 : 99;
  value.previous_invoice_count = null;
  value.currencies = ["CZK", "EUR"];
  value.charts = Object.fromEntries(value.currencies.map(currency => {
    const url = new URL(`https://fixture.invalid/api/reports?from=${value.report_from}&to=${value.period.to}&currency=${currency}`);
    return [currency, {
      monthly: scenarioReport(url, scenario === "empty").monthly,
      statuses: Object.fromEntries(["paid", "pending", "overdue"].map(status => {
        url.searchParams.set("status", status);
        return [status, { monthly: scenarioReport(url, scenario === "empty").monthly }];
      })),
    }];
  }));
  return value;
}

// Disjoint synthetic cohorts. Paid portions include partial payments exactly once.
export function scenarioReport(url, empty = false) {
  const status = url.searchParams.get("status");
  const from = (url.searchParams.get("from") || "2025-11-01").slice(0, 7);
  const to = (url.searchParams.get("to") || "2026-10-18").slice(0, 7);
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const key =
      i < 2 ? `2025-${i + 11}` : `2026-${String(i - 1).padStart(2, "0")}`;
    const issued = 100000 + (i % 4) * 30000;
    const paid = 40000 + (i % 3) * 25000;
    const remainder = issued - paid;
    const cohorts = {
      paid: { issued: paid * 0.7, paid: paid * 0.7 },
      pending: { issued: remainder * 0.7 + paid * 0.2, paid: paid * 0.2 },
      overdue: { issued: remainder * 0.3 + paid * 0.1, paid: paid * 0.1 },
    };
    return { key, ...(cohorts[status] || { issued, paid }), count: 10 };
  }).filter((row) => row.key >= from && row.key <= to);
  return {
    monthly: empty ? [] : monthly,
    invoice_count: empty ? 0 : 124,
    counts: {
      paid: empty ? 0 : 99,
      pending: empty ? 0 : 18,
      overdue: empty ? 0 : 7,
      cancelled: 0,
    },
    currencies: ["CZK", "EUR"],
  };
}

export function scenarioInvoiceDetail(id, scenario = "normal") {
  const base = scenarioSummary(scenario);
  const invoice =
    base.recent.find((item) => item.id === id) ||
    invoices.find((item) => item.id === id) ||
    invoices[0];
  return {
    invoice: {
      ...invoice,
      id,
      reminders_paused: false,
      next_reminder_at: invoice.next_reminder_at,
    },
    can_manage: scenario !== "viewer",
    suppression: null,
    payments: [],
    events: [],
    reminders: ["escalation", "overdue", "on_due", "before_due"].map(
      (stage, index) => ({
        id: `${id}-reminder-${index}`,
        stage,
        scheduled_for: `2026-10-${18 - index}T08:00:00Z`,
        status: index === 0 ? "sent" : "skipped",
        sent_at: index === 0 ? "2026-10-18T08:00:00Z" : null,
        sent_to: invoice.counterparty_email,
        attempt_count: 1,
        error_message: null,
        delivery_status: index === 0 ? "delivered" : null,
        delivered_at: index === 0 ? "2026-10-18T08:01:00Z" : null,
        delivery_event_at: null,
        delivery_error: null,
      }),
    ),
  };
}

export function scenarioInvoiceCount(url, scenario = "normal") {
  if (scenario === "empty") return 0;
  if (url.searchParams.get("status") === "paid") return 99;
  return url.searchParams.get("to") === "2026-10-17" || !url.searchParams.has("from") ? 124 : 110;
}
