import type { InvoiceOcrOrganization, OcrDocumentKind } from "./invoice-ocr";
import type { ExactSourceReading } from "./invoice-ocr-sources";

// ISDOC (český standard elektronické faktury, verze 6) vložený jako příloha
// PDF. Je to strojově čitelná kopie celé faktury, takže je to nejpřesnější
// zdroj, jaký může dokument mít -- ale jen když je XML platné a opravdu ISDOC.
//
// Záměrně vlastní minimální parser bez DTD: <!DOCTYPE> se odmítá celý, takže
// externí entity (XXE) ani "billion laughs" nemohou nastat. Znají se jen
// předdefinované a číselné entity.

type XmlNode = { name: string; children: XmlNode[]; text: string };

const MAX_ISDOC_BYTES = 2_000_000;
const ISDOC_NAMESPACE = /^http:\/\/isdoc\.cz\/namespace\//;

function decodeEntities(value: string): string | null {
  let failed = false;
  const decoded = value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    const known: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (!(entity in known)) failed = true;
    return known[entity] ?? "";
  });
  return failed ? null : decoded;
}

function parseXml(xml: string): { root: XmlNode; namespace: string | null } | null {
  if (!xml || xml.length > MAX_ISDOC_BYTES) return null;
  if (/<!DOCTYPE/i.test(xml)) return null;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let namespace: string | null = null;
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)/g;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(xml)) !== null) {
    const [, cdata, closing, rawName, attributes, selfClosing, text, strayLt] = match;
    if (strayLt) return null;
    if (cdata !== undefined) {
      if (stack.length) stack[stack.length - 1].text += cdata;
      continue;
    }
    if (text !== undefined) {
      if (!stack.length) {
        if (text.trim()) return null;
        continue;
      }
      const decoded = decodeEntities(text);
      if (decoded === null) return null;
      stack[stack.length - 1].text += decoded;
      continue;
    }
    if (!rawName) continue; // comment / processing instruction
    const name = rawName.includes(":") ? rawName.slice(rawName.indexOf(":") + 1) : rawName;
    if (closing) {
      const open = stack.pop();
      if (!open || open.name !== name) return null;
      continue;
    }
    const node: XmlNode = { name, children: [], text: "" };
    if (!stack.length) {
      if (root) return null;
      root = node;
      namespace = attributes?.match(/\sxmlns(?::[\w.-]+)?\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
    } else {
      stack[stack.length - 1].children.push(node);
    }
    if (!selfClosing) stack.push(node);
  }
  if (stack.length || !root) return null;
  return { root, namespace };
}

function child(node: XmlNode | undefined, ...path: string[]): XmlNode | undefined {
  let current = node;
  for (const name of path) current = current?.children.find(item => item.name === name);
  return current;
}

function textAt(node: XmlNode | undefined, ...path: string[]) {
  const value = child(node, ...path)?.text.trim();
  return value ? value : null;
}

function amountAt(node: XmlNode | undefined, ...path: string[]) {
  const value = textAt(node, ...path);
  if (value === null || !/^-?\d{1,13}(?:\.\d{1,6})?$/.test(value)) return null;
  return Math.round(Number(value) * 100) / 100;
}

function isoDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export type IsdocParty = { ico: string | null; dic: string | null; name: string | null; email: string | null };

export type IsdocInvoice = {
  documentType: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  taxPointDate: string | null;
  dueDate: string | null;
  variableSymbol: string | null;
  currency: string | null;
  taxExclusiveAmount: number | null;
  taxInclusiveAmount: number | null;
  payableAmount: number | null;
  vatRates: number[];
  supplier: IsdocParty;
  customer: IsdocParty;
};

function party(node: XmlNode | undefined): IsdocParty {
  const partyNode = child(node, "Party");
  const ico = textAt(partyNode, "PartyIdentification", "ID")?.replace(/\s/g, "") ?? null;
  const dic = textAt(partyNode, "PartyTaxScheme", "CompanyID")?.replace(/\s/g, "").toUpperCase() ?? null;
  return {
    ico: ico && /^\d{6,10}$/.test(ico) ? ico : null,
    dic: dic && /^[A-Z]{2}[A-Z0-9]{2,14}$/.test(dic) ? dic : null,
    name: textAt(partyNode, "PartyName", "Name")?.replace(/\s+/g, " ").slice(0, 200) ?? null,
    email: textAt(partyNode, "Contact", "ElectronicMail")?.toLowerCase().slice(0, 254) ?? null,
  };
}

export function parseIsdoc(xml: string): IsdocInvoice | null {
  const parsed = parseXml(xml.replace(/^﻿/, ""));
  if (!parsed || parsed.root.name !== "Invoice" || !parsed.namespace || !ISDOC_NAMESPACE.test(parsed.namespace)) return null;
  const invoice = parsed.root;
  const foreign = textAt(invoice, "ForeignCurrencyCode");
  const monetary = child(invoice, "LegalMonetaryTotal");
  // U cizí měny nesou platné částky prvky s příponou "Curr"; bez ní jsou
  // přepočtené do místní měny a do pohledávky nepatří.
  const money = (name: string) => (foreign ? amountAt(monetary, `${name}Curr`) : amountAt(monetary, name));
  const details = child(invoice, "PaymentMeans", "Payment", "Details");
  const vs = textAt(details, "VariableSymbol");
  const rates = (child(invoice, "TaxTotal")?.children ?? [])
    .filter(node => node.name === "TaxSubTotal" && (amountAt(node, "TaxableAmount") ?? 0) !== 0)
    .map(node => amountAt(node, "TaxCategory", "Percent"))
    .filter((rate): rate is number => rate !== null);
  return {
    documentType: textAt(invoice, "DocumentType"),
    invoiceNumber: textAt(invoice, "ID")?.slice(0, 100) ?? null,
    issueDate: isoDate(textAt(invoice, "IssueDate")),
    taxPointDate: isoDate(textAt(invoice, "TaxPointDate")),
    dueDate: isoDate(textAt(details, "PaymentDueDate")),
    variableSymbol: vs && /^\d{1,10}$/.test(vs) ? vs : null,
    currency: (foreign ?? textAt(invoice, "LocalCurrencyCode"))?.toUpperCase() ?? null,
    taxExclusiveAmount: money("TaxExclusiveAmount"),
    taxInclusiveAmount: money("TaxInclusiveAmount"),
    payableAmount: money("PayableAmount"),
    vatRates: [...new Set(rates)],
    supplier: party(child(invoice, "AccountingSupplierParty")),
    customer: party(child(invoice, "AccountingCustomerParty")),
  };
}

// Kódy DocumentType podle ISDOC 6.
const DOCUMENT_KINDS: Record<string, OcrDocumentKind> = {
  "1": "issued_invoice", // faktura – daňový doklad
  "2": "credit_note", // opravný daňový doklad (dobropis)
  "3": "other", // opravný daňový doklad (vrubopis)
  "4": "proforma", // zálohová faktura (nedaňový zálohový list)
  "5": "other", // daňový doklad k přijaté platbě -- nejde o pohledávku
  "6": "credit_note", // opravný daňový doklad k přijaté platbě
  "7": "issued_invoice", // zjednodušený daňový doklad
};

export function isdocToExactReading(isdoc: IsdocInvoice, organization: InvoiceOcrOrganization, fileName: string): ExactSourceReading {
  const label = `ISDOC příloha ${fileName}`.slice(0, 120);
  const warnings: string[] = [];
  const values: ExactSourceReading["values"] = {};
  const ownIco = (organization.ico ?? "").replace(/\D/g, "");
  const set = <K extends keyof ExactSourceReading["values"]>(field: K, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== "") values[field] = value;
  };

  set("invoice_number", isdoc.invoiceNumber);
  set("variable_symbol", isdoc.variableSymbol);
  set("issue_date", isdoc.issueDate);
  set("due_date", isdoc.dueDate);

  if (ownIco && isdoc.customer.ico === ownIco) {
    warnings.push("ISDOC uvádí vaši firmu jako odběratele – nejde o vydanou fakturu. Identita protistrany nebyla z ISDOC předvyplněna.");
  } else {
    set("counterparty_name", isdoc.customer.name);
    set("counterparty_ico", isdoc.customer.ico);
    set("counterparty_dic", isdoc.customer.dic);
    set("counterparty_email", isdoc.customer.email);
  }
  if (ownIco && isdoc.supplier.ico && isdoc.supplier.ico !== ownIco) {
    warnings.push(`Dodavatel v ISDOC (IČO ${isdoc.supplier.ico}) neodpovídá firmě z Nastavení. Ověřte, že jde o vaši vydanou fakturu.`);
  }

  set("amount", isdoc.taxInclusiveAmount);
  set("amount_without_vat", isdoc.taxExclusiveAmount);
  set("currency", isdoc.currency && /^[A-Z]{3}$/.test(isdoc.currency) ? isdoc.currency : null);
  if (isdoc.vatRates.length === 1) set("vat_rate", isdoc.vatRates[0]);
  else if (isdoc.vatRates.length > 1) warnings.push("ISDOC obsahuje více sazeb DPH. Sazba nebyla z ISDOC předvyplněna – zkontrolujte ji.");
  else if (isdoc.taxExclusiveAmount !== null && isdoc.taxExclusiveAmount === isdoc.taxInclusiveAmount) set("vat_rate", 0);

  const kind = isdoc.documentType ? DOCUMENT_KINDS[isdoc.documentType] : undefined;
  if (isdoc.documentType && !kind) warnings.push(`ISDOC má neznámý typ dokladu (${isdoc.documentType}). Ověřte typ dokladu.`);

  return {
    method: "isdoc",
    label,
    values,
    evidence: Object.fromEntries(Object.entries(values).map(([field, value]) => [field, `${label}: ${value}`])),
    document_kind: kind,
    payable_amount: isdoc.payableAmount ?? undefined,
    warnings,
  };
}
