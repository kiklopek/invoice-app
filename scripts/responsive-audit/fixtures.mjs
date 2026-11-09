import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
export const NOW = "2026-10-19T08:00:00.000Z";
export async function fixtures(sourceRoot, scenario = "normal") {
  const imp = (p) => import(pathToFileURL(resolve(sourceRoot, p)).href);
  const [dash, report, invoice, sub] = await Promise.all([
    imp("scripts/dashboard-design-fixtures.mjs"),
    imp("scripts/reports-design-fixtures.mjs"),
    imp("scripts/invoices-design-fixtures.mjs"),
    imp("scripts/subscription-design-fixtures.mjs"),
  ]);
  const neutralize = (value) => {
    if (Array.isArray(value)) return value.map(neutralize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        ["counterparty_name", "customer_name"].includes(k)
          ? "Ukázkový odběratel s.r.o."
          : k === "customers" && Array.isArray(v) && typeof v[0] === "string"
            ? v.map((_, i) => `Ukázkový odběratel ${i + 1}`)
            : // any list of customers/debtors (incl. customer_concentration on reports)
              /customer|debtor/.test(k) && Array.isArray(v)
              ? v.map((x, i) =>
                  typeof x === "object"
                    ? { ...neutralize(x), name: `Ukázkový odběratel ${i + 1}` }
                    : x,
                )
              : neutralize(v),
      ]),
    );
  };
  const empty = scenario === "empty",
    stress = scenario === "stress",
    viewer = scenario === "viewer";
  const supplier = {
    name: "Ukázková firma s.r.o.",
    ico: "12345678",
    dic: "CZ12345678",
    address: "Ukázková 1, Praha",
    registered_address: "Ukázková 1, Praha",
    operating_address: "",
    data_box_id: "",
    phone: "",
    email: "demo@example.invalid",
    vat_payer: scenario !== "nonvat",
    bank_account_czk: "123456789/0100",
    bank_account_eur: "",
    bank_accounts: [],
    logo_path: null,
    revision: 1,
  };
  const rows = invoice.invoiceRows.map((r, i) => ({
    ...r,
    counterparty_name: stress
      ? "Mezinárodní společnost s velmi dlouhým obchodním názvem bez možnosti zkrácení ".repeat(
          2,
        )
      : `Ukázkový odběratel ${i + 1} s.r.o.`,
    counterparty_email: `kontakt${i + 1}@example.invalid`,
    file_url: null,
    ...(stress
      ? {
          amount: 999999999999.99,
          invoice_number: "FV-2026-NEOBVYKLE-DLOUHE-CISLO-1234567890",
        }
      : {}),
  }));
  const list = invoice.invoicePage(
    undefined,
    empty ? "empty" : viewer ? "viewer" : "normal",
    rows,
  );
  const customers = {
    can_manage: !viewer,
    customers: empty
      ? []
      : rows.map((r, i) => ({
          id: String(i + 1),
          name: r.counterparty_name,
          ico: "12345678",
          dic: "CZ12345678",
          address: "Ukázková ulice 123, Praha 110 00",
          email: stress
            ? "velmi.dlouha.kontaktni.adresa.pro.overeni.zalamovani@example.invalid"
            : r.counterparty_email,
          phone: "+420 777 123 456",
          notes: null,
          total_invoiced: r.amount,
          outstanding:
            i === 0 ? r.amount : Math.max(0, r.amount - r.paid_amount),
          overdue_amount: i < 3 ? r.amount : 0,
          overdue_count: i < 3 ? 1 : 0,
          invoice_count: i + 1,
          last_invoice_date: r.issue_date,
          reminder_policy_name: i % 2 ? "Standardní upomínky" : null,
        })),
  };
  const summary = neutralize(
    dash.scenarioSummary(empty ? "empty" : stress ? "stress" : "normal"),
  );
  const detail = neutralize(dash.scenarioInvoiceDetail(dash.invoices[0].id));
  detail.invoice = {
    ...rows[0],
    reminder_policy: { name: "Standardní" },
    ...(scenario === "paid"
      ? { status: "paid", paid_amount: rows[0].amount }
      : {}),
  };
  detail.payments = [];
  detail.can_manage = !viewer;
  if (empty) {
    detail.reminders = [];
    detail.events = [];
  }
  const policy = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Standardní",
    is_default: true,
    days_from_due: [-3, 0, 7, 14],
    archived_at: null,
  };
  const templates = Object.fromEntries(
    ["before_due", "on_due", "overdue", "escalation"].map((stage) => [
      stage,
      {
        subject: "Faktura {{invoice_number}}",
        body: "Dobrý den, připomínáme fakturu {{invoice_number}} v částce {{amount}} {{currency}}.",
        reply_to: null,
        cc: [],
      },
    ]),
  );
  const reminder = {
    settings: {
      active: false,
      days: policy.days_from_due,
      templates,
      last_change: null,
    },
    company: supplier,
    policies: [policy],
    operations: {
      can_run: !viewer,
      upcoming: empty
        ? []
        : rows
            .slice(0, 4)
            .map((r) => ({ ...r, next_reminder_at: "2026-10-20T08:00:00Z" })),
      failed: [],
      recent: [],
      automation_run: null,
    },
  };
  const settings = {
    company: supplier,
    bank_accounts: [],
    draft_scope: "audit:synthetic",
    members: [
      {
        id: "audit-user",
        email: "demo@example.invalid",
        role: "admin",
        active: true,
        current: true,
        created_at: NOW,
      },
    ],
    access_events: [],
    current_role: viewer ? "viewer" : "admin",
    registration_path: null,
    support_sessions: [],
  };
  const payments = {
    payments: empty
      ? []
      : rows.slice(0, 4).map((r, i) => ({
          id: "payment-" + i,
          external_id: "AUDIT-" + i,
          booked_on: "2026-10-18",
          amount: r.amount,
          currency: "CZK",
          variable_symbol: r.variable_symbol,
          counterparty_name: r.counterparty_name,
          match_status: i ? "unmatched" : "matched",
          source: "bank_import",
          invoice_id: i ? null : r.id,
          invoices: i
            ? null
            : {
                invoice_number: r.invoice_number,
                counterparty_name: r.counterparty_name,
              },
          allocations: [],
        })),
    open_invoices: rows.map((r) => ({ ...r })),
    can_manage: !viewer,
    gpc_enabled: true,
    runtime_mode: "production-database",
    assistance_flags: {
      mode: "off",
      memory: false,
      reevaluation: false,
      camt: false,
    },
  };
  const billing = sub.subscriptionFixture(
    empty ? "missing" : viewer ? "readonly" : "active",
  );
  const reports = neutralize(
    report.reportsFixture(empty ? "empty" : "populated"),
  );
  const notifications = {
    items: empty
      ? []
      : [
          {
            id: "audit-notification",
            type: "invoice_overdue",
            title: "Faktura po splatnosti",
            message: "Ukázková faktura čeká na úhradu.",
            created_at: NOW,
            read_at: null,
            href: "/invoices",
          },
        ],
    unread_count: empty ? 0 : 1,
    total: empty ? 0 : 1,
    has_more: false,
    through: NOW,
    next_cursor: null,
  };
  return {
    // Synthetic invitation for /pozvanka (fictional company, reserved domain).
    invitation: { status: "valid", email: "pozvany@example.invalid", role: "accounting", companyName: "Ukázková firma s.r.o.", companyLogo: null, expiresAt: "2026-10-26T12:00:00Z" },
    summary,
    reports,
    list,
    totals: invoice.invoiceTotals(undefined, empty ? "empty" : "normal", rows),
    initialQuery: invoice.initialQuery,
    rows,
    detail,
    customers,
    reminder,
    settings,
    payments,
    billing,
    notifications,
    supplier,
    policy,
    creation: {
      supplier,
      customers: customers.customers,
      today: "2026-10-19",
      suggested_number: "FV-2026-000027",
      draft_scope: "audit-org:audit-user",
      can_send: true,
    },
    profile: {
      role: viewer ? "viewer" : "admin",
      name: "Ukázkový uživatel",
      email: "demo@example.invalid",
      companyName: supplier.name,
      vatPayer: supplier.vat_payer,
    },
  };
}
