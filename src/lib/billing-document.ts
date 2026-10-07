import { buildSpayd } from "@/lib/czech-payment";
import { findPlan } from "@/lib/plans";
import type { BillingDetails, Supplier } from "@/lib/billing";

// Obsah dokladu za předplatné Splatna (bez kreslení PDF, aby šel testovat).
// Nezaplacená objednávka převodem = výzva k platbě s QR platbou; zaplacená
// = faktura (u plátce DPH daňový doklad s datem zdanitelného plnění).

export type BillingOrderForDocument = {
  order_number: string;
  variable_symbol: string;
  plan: string;
  period: string;
  months: number;
  net_halere: number;
  vat_halere: number;
  gross_halere: number;
  status: string;
  invoice_number: string | null;
  created_at: string;
  paid_at: string | null;
  billing: Partial<BillingDetails>;
};

function isoDate(value: string | Date) {
  return new Date(value).toISOString().slice(0, 10);
}

export function billingDocument(order: BillingOrderForDocument, supplier: Supplier, dueDays = 7) {
  const paid = order.status === "paid" && Boolean(order.invoice_number);
  const plan = findPlan(order.plan);
  const item = `Splatno – tarif ${plan?.name ?? order.plan}, ${order.months === 12 ? "12 měsíců" : "1 měsíc"}`;
  const due = new Date(new Date(order.created_at).getTime() + dueDays * 24 * 3600_000);
  const title = paid
    ? supplier.vatPayer ? `Faktura – daňový doklad č. ${order.invoice_number}` : `Faktura č. ${order.invoice_number}`
    : `Výzva k platbě (objednávka ${order.order_number})`;
  const spayd = paid ? null : buildSpayd({
    account: supplier.account,
    amount: order.gross_halere / 100,
    currency: "CZK",
    variableSymbol: order.variable_symbol,
    dueDate: isoDate(due),
    message: `Splatno ${order.order_number}`,
  });
  return {
    title,
    paid,
    item,
    issueDate: isoDate(paid && order.paid_at ? order.paid_at : order.created_at),
    taxableDate: paid && supplier.vatPayer && order.paid_at ? isoDate(order.paid_at) : null,
    dueDate: isoDate(due),
    spayd,
    filename: paid ? `splatno-faktura-${order.invoice_number}.pdf` : `splatno-vyzva-${order.order_number}.pdf`,
  };
}
