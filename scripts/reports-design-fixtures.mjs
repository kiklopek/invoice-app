export function reportsFixture(mode = "populated") {
  const customers = [
    "WOOD & PAPER a.s.",
    "Marland s.r.o.",
    "probautex s.r.o.",
    "C.S.CARGO a.s.",
    "PST CLC Mitsui-Soko a.s.",
    "Odběratel šest",
    "Odběratel sedm",
    "Odběratel osm",
    "Odběratel devět",
    "Odběratel deset",
    "Odběratel jedenáct",
  ];
  const report = {
    invoice_count: 47,
    total: 2237755.25,
    paid: 398185.25,
    open: 1839570,
    overdue: 1586930,
    paid_rate: 18,
    counts: {
      pending: 5,
      overdue: 24,
      paid: 17,
      cancelled: 1,
      cancelled_amount: 12100,
    },
    aging: [
      { label: "Před splatností", amount: 252640, count: 5 },
      { label: "1–7 dní", amount: 106192, count: 3 },
      { label: "8–14 dní", amount: 35000, count: 1 },
      { label: "15–30 dní", amount: 50448, count: 1 },
      { label: "Více než 30 dní", amount: 1395290, count: 19 },
    ],
    monthly: Array.from({ length: 10 }, (_, i) => ({
      key: `2026-${String(i + 1).padStart(2, "0")}`,
      issued: i === 9 ? 437755.25 : 200000,
      paid: i === 9 ? 38185.25 : 40000,
      count: i === 9 ? 2 : 5,
    })),
    debtors: customers.slice(0, 7).map((name, i) => ({
      name,
      open: i === 0 ? 1320319 : 86541.833333,
      overdue: i === 0 ? 1320319 : 44435.166667,
      count: i === 0 ? 10 : 3,
      reminders: i === 0 ? 4 : 1,
    })),
    currencies: ["CZK", "EUR"],
    customers,
    vat_breakdown: [
      { vat_rate: 0, base: 39000, tax: 0, gross: 39000, count: 10 },
      {
        vat_rate: 21,
        base: 1817153.1,
        tax: 381602.15,
        gross: 2198755.25,
        count: 37,
      },
    ],
    dso: { avg_days: 18.5, paid_invoice_count: 17 },
    dso_monthly: [
      { key: "2026-09", avg_days: 12.5, count: 8 },
      { key: "2026-10", avg_days: 24, count: 9 },
    ],
    customer_concentration: customers
      .slice(0, 10)
      .map((name, i) => ({
        name,
        revenue: i === 0 ? 1300000 : 90000,
        count: 4,
      }))
      .concat([{ name: "Ostatní", revenue: 127755.25, count: 7 }]),
    yoy_monthly: [
      { month: "09", current_year: 200000, prior_year: 180000 },
      { month: "10", current_year: 437755.25, prior_year: 320000 },
    ],
    payment_reconciliation: {
      totals: {
        imports: 5,
        accepted: 172,
        auto_matched: 120,
        needs_review: 52,
        unmatched_payments: 22,
        unacknowledged_mismatch_imports: 0,
      },
      monthly: [
        {
          key: "2026-09",
          imports: 2,
          accepted: 100,
          auto_matched: 70,
          needs_review: 30,
        },
        {
          key: "2026-10",
          imports: 3,
          accepted: 72,
          auto_matched: 50,
          needs_review: 22,
        },
      ],
      recent_imports: Array.from({ length: 5 }, (_, i) => ({
        id: `fixture-${i}`,
        filename: `vypis_GPC_2026-10-${String(23 - i).padStart(2, "0")}.gpc`,
        committed_at: `2026-10-${String(23 - i).padStart(2, "0")}T12:00:00Z`,
        accepted_count: [36, 35, 34, 34, 33][i],
        ignored_count: 2,
        error_count: 1,
        auto_matched: 20,
        needs_review: 12,
      })),
    },
  };
  if (mode === "empty")
    return {
      ...report,
      invoice_count: 0,
      total: 0,
      paid: 0,
      open: 0,
      overdue: 0,
      counts: {
        pending: 0,
        overdue: 0,
        paid: 0,
        cancelled: 0,
        cancelled_amount: 0,
      },
      aging: report.aging.map((row) => ({ ...row, amount: 0, count: 0 })),
      monthly: [],
      debtors: [],
      vat_breakdown: [],
      dso: { avg_days: 0, paid_invoice_count: 0 },
      dso_monthly: [],
      customer_concentration: [],
      yoy_monthly: [],
      payment_reconciliation: {
        totals: {
          imports: 0,
          accepted: 0,
          auto_matched: 0,
          needs_review: 0,
          unmatched_payments: 0,
          unacknowledged_mismatch_imports: 0,
        },
        monthly: [],
        recent_imports: [],
      },
    };
  if (mode === "changing-aging") {
    const amounts = [0, 392090.11, 107454.05, 1054707.07, 1285319000.23];
    report.aging = report.aging.map((row, index) => ({
      ...row,
      amount: amounts[index],
    }));
    report.open = amounts.reduce((sum, amount) => sum + amount, 0);
    report.overdue = report.open;
  }
  if (mode === "negative") {
    report.aging[0].amount = -100;
    report.vat_breakdown[0].gross = -39000;
  }
  if (mode === "eur") {
    report.total = 1210.5;
    report.paid = 300;
    report.open = 910.5;
    report.invoice_count = 1;
    report.counts = {
      pending: 1,
      overdue: 0,
      paid: 0,
      cancelled: 0,
      cancelled_amount: 0,
    };
    report.monthly = [{ key: "2026-10", issued: 1210.5, paid: 300, count: 1 }];
    report.vat_breakdown = [
      { vat_rate: 21, base: 1000.41, tax: 210.09, gross: 1210.5, count: 1 },
    ];
    report.customer_concentration = [
      { name: "EUR odběratel", revenue: 1210.5, count: 1 },
    ];
  }
  return report;
}
