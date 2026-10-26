import type { ReportQuery, InvoiceReport } from "./report-query";
import type { PaymentReconciliationSummary } from "./payment-reconciliation-query";
import type { InvoiceStatus } from "@/types/invoice";
export const REPORT_SECTIONS = {
  revenue: "Tržby",
  vat: "DPH",
  receivables: "Pohledávky",
  payments: "Platby",
} as const;
export const REPORT_MODES = {
  summary: "Souhrnný report",
  detailed: "Detailní report",
  complete: "Kompletní finanční report",
  custom: "Vlastní report",
} as const;
export type ReportSection = keyof typeof REPORT_SECTIONS;
export type ReportOptions = {
  mode: keyof typeof REPORT_MODES;
  sections: ReportSection[];
  charts: boolean;
  details: boolean;
  customers: boolean;
  orientation: "portrait" | "landscape";
};
export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  mode: "complete",
  sections: Object.keys(REPORT_SECTIONS) as ReportSection[],
  charts: true,
  details: true,
  customers: true,
  orientation: "portrait",
};
export const REPORT_STATUS: Record<InvoiceStatus, string> = {
  pending: "Čeká na úhradu",
  overdue: "Po splatnosti",
  paid: "Zaplaceno",
  cancelled: "Stornováno",
};
export const REPORT_BASES = {
  issue_date: "Datum vystavení",
  due_date: "Datum splatnosti",
  paid_at: "Datum úplné úhrady (Europe/Prague)",
};
export type ReportInvoiceRow = {
  id: string;
  invoice_number: string;
  counterparty_name: string;
  amount_without_vat: number;
  amount: number;
  vat_rate: number;
  paid_amount: number;
  remaining_amount: number;
  currency: string;
  issue_date: string;
  due_date: string;
  paid_at: string | null;
  status: InvoiceStatus;
  reminders_sent: number;
  vat_groups?:
    { rate: number | null; net: number; tax: number; gross: number }[] | null;
};
export type ReportAmount = number | string;
export type FinancialReportSnapshot = {
  exact_totals?: {
    total: string;
    paid: string;
    open: string;
    overdue: string;
    base: string;
    tax: string;
  };
  exact_aging?: { label: string; amount: string; count: number }[];
  exact_debtors?: {
    name: string;
    open: string;
    overdue: string;
    count: number;
    reminders: number;
  }[];
  exact_vat?: {
    vat_rate: number;
    base: string;
    tax: string;
    gross: string;
    count: number;
  }[];
  company: {
    name: string;
    ico: string | null;
    dic: string | null;
    address: string | null;
  };
  generated_at: string;
  as_of: string;
  report: InvoiceReport;
  payments: PaymentReconciliationSummary;
  invoices: ReportInvoiceRow[];
  customers: {
    name: string;
    invoiced: ReportAmount;
    paid: ReportAmount;
    count: number;
  }[];
  imports: PaymentReconciliationSummary["recent_imports"];
};
export type FinancialReportModel = {
  snapshot: FinancialReportSnapshot;
  query: ReportQuery;
  options: ReportOptions;
};
export function parseReportOptions(value: unknown): ReportOptions {
  const v = value as ReportOptions | null;
  if (
    !v ||
    !Object.hasOwn(REPORT_MODES, v.mode) ||
    !Array.isArray(v.sections) ||
    !v.sections.length ||
    v.sections.length > 4 ||
    new Set(v.sections).size !== v.sections.length ||
    !v.sections.every((s) => Object.hasOwn(REPORT_SECTIONS, s)) ||
    ![v.charts, v.details, v.customers].every((b) => typeof b === "boolean") ||
    !["portrait", "landscape"].includes(v.orientation)
  )
    throw new Error("Zkontrolujte typ a obsah reportu.");
  const sections = (Object.keys(REPORT_SECTIONS) as ReportSection[]).filter(
    (s) => v.sections.includes(s),
  );
  return {
    mode: v.mode,
    sections,
    charts: v.charts,
    details: v.mode === "summary" ? false : v.details,
    customers: v.mode === "summary" ? false : v.customers,
    orientation: v.orientation,
  };
}
export const REPORT_METHODS: Record<ReportSection, string> = {
  revenue:
    "Fakturováno zahrnuje vybrané faktury včetně vybraných storen. Evidované úhrady jsou současné evidované úhrady vybraných nestornovaných faktur, nikoli peněžní tok během období. Měsíční sloupce přiřazují vybrané faktury podle vystavení; měsíční úhrady zahrnují současné úhrady těchto faktur včetně případných storen, stejně jako stávající měsíční přehled.",
  vat: "Tento report není daňovým přiznáním. Období odpovídá zvolenému fakturovému datu, nikoli samostatnému filtru DUZP. Rozpis používá evidované základy a daň (u nových vystavených dokladů i více sazeb), včetně vybraných storen. Neobsahuje vstupní DPH ani odpočty. Označení 0 % / ostatní nerozlišuje neplátce, osvobození a jiné režimy u starších dokladů.",
  receivables:
    "Pohledávky jsou současné zůstatky vybraných otevřených faktur, nikoli rekonstrukce minulého stavu. Částečné úhrady snižují zůstatek. Intervaly stáří používají datum splatnosti a den sestavení. Po splatnosti v KPI odpovídá evidovanému stavu faktury. Průměrná doba úhrady zahrnuje pouze plně uhrazené faktury s datem úplné úhrady, od vystavení do úplného zaplacení.",
  payments:
    "Bankovní část zahrnuje celou firmu, všechny měny a pouze počty. Období výpisů se určuje podle zaúčtování v Europe/Prague, nespárované platby podle data bankovního zaúčtování. Fakturové filtry měny, zákazníka, stavu a datumového základu se na ni nevztahují. Bezpečný návrh znamená posouzení shody; neříká, zda zaúčtování proběhlo automaticky. Ruční posouzení zahrnuje přijaté řádky s posouzením review i bez návrhu. Detail je na úrovni celých potvrzených výpisů, nikoli jednotlivých bankovních řádků.",
};

/** Presentation only. SQL decimal strings retain cents even beyond JS integer precision. */
export function createReportMoney(currency: string) {
  const integer = new Intl.NumberFormat("cs-CZ");
  const symbol =
    new Intl.NumberFormat("cs-CZ", { style: "currency", currency })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value ?? currency;
  return (value: ReportAmount) => {
    const raw = typeof value === "number" ? value.toFixed(2) : value;
    if (!/^-?\d+(?:\.\d+)?$/.test(raw))
      throw new Error("Neplatná peněžní hodnota reportu.");
    const negative = raw.startsWith("-"),
      [whole, fraction = ""] = raw.replace(/^-/, "").split(".");
    let cents =
      BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
    if (Number(fraction[2] ?? 0) >= 5) cents++;
    return `${negative && cents ? "−" : ""}${integer.format(cents / 100n)},${String(cents % 100n).padStart(2, "0")} ${symbol}`;
  };
}
