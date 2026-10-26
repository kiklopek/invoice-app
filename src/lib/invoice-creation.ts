import { minorUnits } from "./money";
import { isIsoDate } from "./invoice-validation";
import { organizationAccounts, ownInvoiceAccount } from "./bank-accounts";
import { INVOICE_CURRENCIES } from "./invoice-currency";
import type { InvoiceInput } from "@/types/invoice";

export type InvoiceParty = {
  name: string;
  ico: string;
  dic: string;
  address: string;
  email: string;
};
export type InvoiceSupplier = InvoiceParty & {
  logo_path?: string | null;
  vat_payer: boolean | null;
  bank_account_czk: string;
  bank_account_eur: string;
  bank_accounts: { account: string; currency: string }[];
};
export type CreationItem = {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  discount: string;
  vat_rate: number | null;
};
export type CreationDraft = {
  version: 1;
  request_id: string;
  invoice_number: string;
  variable_symbol: string;
  issue_date: string;
  tax_date: string;
  due_date: string;
  currency: string;
  payment_method: "bank" | "cash";
  payment_account: string;
  customer_id: string;
  customer: InvoiceParty;
  items: CreationItem[];
  public_note: string;
  internal_note: string;
  attachment: { path: string; name: string } | null;
};
export type CreationLine = CreationItem & {
  net: number;
  tax: number;
  gross: number;
};
export type CreationTotals = {
  lines: CreationLine[];
  net: number;
  tax: number;
  gross: number;
  discounts: number;
  breakdown: { rate: number | null; net: number; tax: number; gross: number }[];
};
export type IssuedInvoiceDocument = {
  version: 1;
  request_id: string;
  request_hash: string;
  supplier: InvoiceParty & { vat_payer: boolean; logo_path?: string | null };
  customer: InvoiceParty;
  customer_id: string;
  invoice_number: string;
  variable_symbol: string;
  issue_date: string;
  tax_date: string;
  due_date: string;
  currency: string;
  payment_method: "bank" | "cash";
  payment_account: string;
  totals: CreationTotals;
  public_note: string;
  internal_note: string;
  attachment: { path: string; name: string } | null;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MINOR = 99_999_999_999_999n;
function decimal(value: string, precision: number, name: string): bigint {
  const raw = value.trim().replace(",", ".");
  if (!new RegExp(`^\\d{1,12}(?:\\.\\d{1,${precision}})?$`).test(raw))
    throw new InvoiceCreationError(
      `${name}: zadejte nezáporné číslo, nejvýše ${precision} desetinných míst.`,
    );
  const [whole, fraction = ""] = raw.split(".");
  return (
    BigInt(whole) * 10n ** BigInt(precision) +
    BigInt(fraction.padEnd(precision, "0"))
  );
}
const rounded = (value: bigint, divisor: bigint) =>
  (value + divisor / 2n) / divisor;
const major = (value: bigint) => {
  if (value < 0 || value > MAX_MINOR)
    throw new InvoiceCreationError("Částka je mimo podporovaný rozsah.");
  return Number(value) / 100;
};

/** Same precision and range as the persisted numeric(5,2) VAT rate. */
export function isCreationVatRate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-8
  );
}

/** Price entry is net, quantities have six decimals, prices four. Round net once per
 * line; round VAT per rate and allocate haléře by largest remainder, stable by row. */
export function calculateCreation(
  items: CreationItem[],
  vatPayer: boolean,
): CreationTotals {
  if (!items.length || items.length > 200)
    throw new InvoiceCreationError("Faktura musí mít 1 až 200 položek.");
  let discounts = 0n;
  const prepared = items.map((item) => {
    const quantity = decimal(item.quantity, 6, "Množství");
    const price = decimal(item.unit_price, 4, "Cena za jednotku");
    const discount = decimal(item.discount || "0", 2, "Sleva");
    if (quantity <= 0 || quantity > 1_000_000_000_000n)
      throw new InvoiceCreationError("Množství musí být větší než nula a nejvýše 1 000 000.");
    if (discount > 10000n) throw new InvoiceCreationError("Sleva musí být mezi 0 a 100 %.");
    if (vatPayer && !isCreationVatRate(item.vat_rate))
      throw new InvoiceCreationError(
        "Sazba DPH musí být od 0 do 100 % s nejvýše dvěma desetinnými místy.",
      );
    const original = rounded(quantity * price, 100_000_000n);
    const net = rounded(
      quantity * price * (10000n - discount),
      1_000_000_000_000n,
    );
    major(net);
    discounts += original - net;
    return { item, net, rate: vatPayer ? item.vat_rate : null, tax: 0n };
  });
  const breakdown = [...new Set(prepared.map((line) => line.rate))].map(
    (rate) => {
      const lines = prepared.filter((line) => line.rate === rate);
      const net = lines.reduce((sum, line) => sum + line.net, 0n);
      const rateMinor = BigInt(Math.round((rate ?? 0) * 100));
      const tax = rounded(net * rateMinor, 10000n);
      let allocated = 0n;
      for (const line of lines) {
        line.tax = (line.net * rateMinor) / 10000n;
        allocated += line.tax;
      }
      const byRemainder = [...lines].sort((a, b) =>
        Number(((b.net * rateMinor) % 10000n) - ((a.net * rateMinor) % 10000n)),
      );
      for (let i = 0; i < Number(tax - allocated); i++) byRemainder[i].tax++;
      return {
        rate,
        net: major(net),
        tax: major(tax),
        gross: major(net + tax),
      };
    },
  );
  const net = prepared.reduce((sum, line) => sum + line.net, 0n),
    tax = prepared.reduce((sum, line) => sum + line.tax, 0n);
  return {
    lines: prepared.map(({ item, net, tax, rate }) => ({
      ...item,
      vat_rate: rate,
      net: major(net),
      tax: major(tax),
      gross: major(net + tax),
    })),
    net: major(net),
    tax: major(tax),
    gross: major(net + tax),
    discounts: major(discounts),
    breakdown,
  };
}

export function supplierProblems(supplier: InvoiceSupplier): string[] {
  return [
    !supplier.name.trim() && "název firmy",
    !supplier.address.trim() && "sídlo firmy",
    !/^\d{8}$/.test(supplier.ico) && "IČO",
    supplier.vat_payer === null && "údaj o plátcovství DPH",
    supplier.vat_payer === true &&
      !/^CZ\d{8,10}$/.test(supplier.dic) &&
      "DIČ plátce DPH",
  ].filter(Boolean) as string[];
}
export function emptyCreation(
  supplier: InvoiceSupplier,
  today: string,
  requestId: string,
  number = "",
): CreationDraft {
  const due = new Date(`${today}T12:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 14);
  return {
    version: 1,
    request_id: requestId,
    invoice_number: number,
    variable_symbol: number.replace(/\D/g, "").slice(-10),
    issue_date: today,
    tax_date: today,
    due_date: due.toISOString().slice(0, 10),
    currency: "CZK",
    payment_method: "bank",
    payment_account:
      organizationAccounts(supplier, supplier.bank_accounts).find(
        (a) => a.currency === "CZK",
      )?.account ?? "",
    customer_id: "",
    customer: { name: "", ico: "", dic: "", address: "", email: "" },
    items: [
      {
        id: requestId,
        description: "",
        quantity: "1",
        unit: "ks",
        unit_price: "0",
        discount: "0",
        vat_rate: supplier.vat_payer === false ? null : 21,
      },
    ],
    public_note: "Děkujeme za spolupráci.",
    internal_note: "",
    attachment: null,
  };
}

/** Strict structural validation happens before any financial operation or tenant lookup. */
export function parseCreationDraft(value: unknown): CreationDraft {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InvoiceCreationError("Neplatný formulář faktury.");
  const d = value as CreationDraft;
  const str = (v: unknown, max: number) =>
    typeof v === "string" &&
    v.length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
  if (
    d.version !== 1 ||
    !UUID.test(d.request_id) ||
    !str(d.invoice_number, 100) ||
    !str(d.variable_symbol, 10) ||
    ![d.issue_date, d.tax_date, d.due_date].every((v) => str(v, 10)) ||
    !INVOICE_CURRENCIES.some((currency) => currency === d.currency) ||
    !["bank", "cash"].includes(d.payment_method) ||
    !str(d.payment_account, 100) ||
    !str(d.customer_id, 36) ||
    (d.customer_id && !UUID.test(d.customer_id)) ||
    !d.customer ||
    !str(d.customer.name, 200) ||
    !str(d.customer.address, 500) ||
    !str(d.customer.email, 254) ||
    !str(d.customer.ico, 20) ||
    !str(d.customer.dic, 24) ||
    !str(d.public_note, 5000) ||
    !str(d.internal_note, 5000) ||
    !Array.isArray(d.items) ||
    !d.items.length ||
    d.items.length > 200 ||
    !d.items.every(
      (i) =>
        i &&
        str(i.id, 100) &&
        str(i.description, 500) &&
        str(i.quantity, 24) &&
        str(i.unit, 20) &&
        str(i.unit_price, 24) &&
        str(i.discount, 10) &&
        (i.vat_rate === null || isCreationVatRate(i.vat_rate)),
    ) ||
    (d.attachment !== null &&
      (!d.attachment ||
        !str(d.attachment.path, 500) ||
        !str(d.attachment.name, 255)))
  )
    throw new InvoiceCreationError("Některé údaje faktury mají neplatný formát nebo délku.");
  // Return only supported keys; client-supplied supplier/totals/organization are discarded.
  return {
    version: 1,
    request_id: d.request_id,
    invoice_number: d.invoice_number.trim(),
    variable_symbol: d.variable_symbol.trim(),
    issue_date: d.issue_date,
    tax_date: d.tax_date,
    due_date: d.due_date,
    currency: d.currency,
    payment_method: d.payment_method,
    payment_account: d.payment_account.trim(),
    customer_id: d.customer_id,
    customer: {
      name: d.customer.name.trim(),
      ico: d.customer.ico.trim(),
      dic: d.customer.dic.trim(),
      address: d.customer.address.trim(),
      email: d.customer.email.trim().toLowerCase(),
    },
    items: d.items.map((i) => ({
      id: i.id,
      description: i.description.trim(),
      quantity: i.quantity,
      unit: i.unit.trim(),
      unit_price: i.unit_price,
      discount: i.discount,
      vat_rate: i.vat_rate,
    })),
    public_note: d.public_note.trim(),
    internal_note: d.internal_note.trim(),
    attachment: d.attachment
      ? { path: d.attachment.path, name: d.attachment.name }
      : null,
  };
}

export function creationDocument(
  draft: CreationDraft,
  supplier: InvoiceSupplier,
  requestHash = "",
): IssuedInvoiceDocument {
  const missing = supplierProblems(supplier);
  if (missing.length)
    throw new InvoiceCreationError(`V nastavení firmy doplňte: ${missing.join(", ")}.`);
  if (!draft.invoice_number || !/^\d{0,10}$/.test(draft.variable_symbol))
    throw new InvoiceCreationError(
      "Vyplňte číslo faktury a číselný variabilní symbol (nejvýše 10 číslic).",
    );
  if (
    ![
      draft.issue_date,
      draft.due_date,
      ...(supplier.vat_payer ? [draft.tax_date] : []),
    ].every(isIsoDate) ||
    draft.due_date < draft.issue_date
  )
    throw new InvoiceCreationError("Zkontrolujte datum vystavení, DUZP a splatnost.");
  if (!draft.customer.name || !draft.customer.address)
    throw new InvoiceCreationError("Doplňte název a fakturační adresu odběratele.");
  if (draft.customer.ico && !/^\d{8}$/.test(draft.customer.ico))
    throw new InvoiceCreationError("IČO odběratele musí mít 8 číslic.");
  if (
    draft.customer.email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.customer.email)
  )
    throw new InvoiceCreationError("Zadejte platný e-mail odběratele.");
  if (supplier.vat_payer && draft.currency !== "CZK")
    throw new InvoiceCreationError(
      "Vystavení daňového dokladu v cizí měně vyžaduje kurz a daň v CZK. Tento režim zatím není podporován.",
    );
  if (draft.items.some((i) => !i.description || !i.unit))
    throw new InvoiceCreationError("Každá položka musí mít název a jednotku.");
  const account =
    draft.payment_method === "bank"
      ? ownInvoiceAccount(
          draft.payment_account,
          draft.currency,
          supplier,
          supplier.bank_accounts,
        )
      : null;
  if (draft.payment_method === "bank" && !account)
    throw new InvoiceCreationError("Vyberte platný firemní účet v měně faktury v Nastavení.");
  const totals = calculateCreation(draft.items, supplier.vat_payer === true);
  if (totals.gross <= 0)
    throw new InvoiceCreationError("Celková částka faktury musí být větší než nula.");
  const { name, ico, dic, address, email } = supplier;
  return {
    version: 1,
    request_id: draft.request_id,
    request_hash: requestHash,
    supplier: {
      name,
      ico,
      dic,
      address,
      email,
      vat_payer: supplier.vat_payer === true,
      logo_path: supplier.logo_path ?? null,
    },
    customer: { ...draft.customer },
    customer_id: draft.customer_id,
    invoice_number: draft.invoice_number,
    variable_symbol: draft.variable_symbol,
    issue_date: draft.issue_date,
    tax_date: supplier.vat_payer ? draft.tax_date : "",
    due_date: draft.due_date,
    currency: draft.currency,
    payment_method: draft.payment_method,
    payment_account: account ?? "",
    totals,
    public_note: draft.public_note,
    internal_note: draft.internal_note,
    attachment: draft.attachment,
  };
}

export function creationInput(document: IssuedInvoiceDocument): InvoiceInput {
  return {
    invoice_number: document.invoice_number,
    counterparty_name: document.customer.name,
    counterparty_ico: document.customer.ico,
    counterparty_dic: document.customer.dic,
    counterparty_email: document.customer.email,
    variable_symbol: document.variable_symbol,
    amount_without_vat: document.totals.net,
    vat_rate:
      document.totals.breakdown.length === 1
        ? (document.totals.breakdown[0].rate ?? 0)
        : 0,
    amount: document.totals.gross,
    currency: document.currency,
    issue_date: document.issue_date,
    due_date: document.due_date,
    payment_account: document.payment_account || null,
    source: "manual",
    notes: document.public_note,
    ...(document.attachment ? { file_url: document.attachment.path } : {}),
    money_evidence: {
      original_total: document.totals.gross,
      total_source: "manual",
      adjustment: 0,
      adjustment_reason: "",
      adjustment_confirmed: false,
      initial_paid: 0,
      initial_paid_confirmed: false,
      multi_rate: document.totals.breakdown.length > 1,
      issued_document: document,
    },
  };
}
export function issuedDocument(invoice: {
  money_evidence?: unknown;
}): IssuedInvoiceDocument | null {
  const evidence = invoice.money_evidence;
  const d =
    evidence && typeof evidence === "object" && !Array.isArray(evidence)
      ? (evidence as Record<string, unknown>).issued_document
      : null;
  return d &&
    typeof d === "object" &&
    !Array.isArray(d) &&
    "version" in d &&
    d.version === 1 &&
    "request_id" in d &&
    typeof d.request_id === "string" &&
    "supplier" in d &&
    d.supplier &&
    "totals" in d &&
    d.totals
    ? (d as unknown as IssuedInvoiceDocument)
    : null;
}

/** Explicit customer-facing projection; internal notes never enter preview/PDF/email. */
export function publicInvoiceDocument(document: IssuedInvoiceDocument) {
  const {
    internal_note: _internal,
    request_hash: _hash,
    attachment: _attachment,
    ...visible
  } = document;
  return visible;
}
export const amountsAgree = (a: number, b: number) =>
  minorUnits(a) === minorUnits(b);

/** Incomplete preview is visibly a concept, with the same calculation/model as issuance. */
export function creationPreview(
  draft: CreationDraft,
  supplier: InvoiceSupplier,
): IssuedInvoiceDocument {
  if (supplier.vat_payer === null)
    throw new InvoiceCreationError("V nastavení firmy doplňte, zda je firma plátcem DPH.");
  return {
    version: 1,
    request_id: draft.request_id,
    request_hash: "",
    supplier: {
      name: supplier.name,
      ico: supplier.ico,
      dic: supplier.dic,
      address: supplier.address,
      email: supplier.email,
      vat_payer: supplier.vat_payer === true,
      logo_path: supplier.logo_path ?? null,
    },
    customer: { ...draft.customer },
    customer_id: draft.customer_id,
    invoice_number: draft.invoice_number,
    variable_symbol: draft.variable_symbol,
    issue_date: draft.issue_date,
    tax_date: supplier.vat_payer ? draft.tax_date : "",
    due_date: draft.due_date,
    currency: draft.currency,
    payment_method: draft.payment_method,
    payment_account:
      draft.payment_method === "bank" ? draft.payment_account : "",
    totals: calculateCreation(draft.items, supplier.vat_payer === true),
    public_note: draft.public_note,
    internal_note: "",
    attachment: null,
  };
}

/** Unit prices retain all entered decimals; only line totals round to cents. */
export function creationUnitPrice(value: string, currency: string) {
  const raw = value.trim().replace(",", ".");
  if (!/^\d{1,12}(?:\.\d{1,4})?$/.test(raw)) return "—";
  const [whole, fraction = ""] = raw.split(".");
  const decimals = fraction.replace(/0+$/, "").padEnd(2, "0");
  const symbol =
    new Intl.NumberFormat("cs-CZ", { style: "currency", currency })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? currency;
  return `${new Intl.NumberFormat("cs-CZ").format(BigInt(whole))},${decimals} ${symbol}`;
}

/** Only these controlled validation messages may be returned by API routes. */
export class InvoiceCreationError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
