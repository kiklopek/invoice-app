import type { InvoiceInput } from "../types/invoice";
import { isIsoDate } from "./invoice-validation";
import { grossFromNet, netFromGross, roundMoney, vatAmountsMatch } from "./vat";

export const LOCAL_OCR_MODEL = "local-tesseract-v2";

export type OcrDocumentKind = "issued_invoice" | "proforma" | "credit_note" | "other";

export type InvoiceOcrResult = {
  invoice: InvoiceInput;
  confidence: number;
  warnings: string[];
  document_kind: OcrDocumentKind;
  issuer_matches_organization: boolean | null;
  model: string;
  response_id: string | null;
};

export type InvoiceOcrOrganization = {
  name: string;
  ico: string | null;
  dic: string | null;
};

type ParsedAmount = { value: number; currency: string | null };

const AMOUNT_SOURCE = "-?\\d{1,3}(?:[ .\u00a0]\\d{3})*(?:[,.]\\d{1,2})?|-?\\d+(?:[,.]\\d{1,2})?";
const CURRENCY_SOURCE = "CZK|Kč|EUR|USD|GBP|PLN|CHF";

function boundedText(value: string | null | undefined, max: number) {
  return (value ?? "").trim().slice(0, max);
}

function normalizeComparable(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("cs")
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeOcrText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function digits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function parseMoney(value: string): number | null {
  const compact = value.replace(/[\s\u00a0]/g, "");
  if (!compact) return null;
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  let normalized = compact;
  if (decimalIndex >= 0 && compact.length - decimalIndex - 1 <= 2) {
    normalized = `${compact.slice(0, decimalIndex).replace(/[.,]/g, "")}.${compact.slice(decimalIndex + 1)}`;
  } else {
    normalized = compact.replace(/[.,]/g, "");
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? roundMoney(number) : null;
}

function currencyCode(value: string | null | undefined) {
  const currency = (value ?? "").toUpperCase();
  if (currency === "KČ") return "CZK";
  return /^(CZK|EUR|USD|GBP|PLN|CHF)$/.test(currency) ? currency : null;
}

function amountFromLine(line: string): ParsedAmount | null {
  const matches = [...line.matchAll(new RegExp(`(${AMOUNT_SOURCE})\\s*(${CURRENCY_SOURCE})?`, "giu"))];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const value = parseMoney(matches[index][1]);
    if (value !== null && Math.abs(value) <= 999_999_999_999.99) {
      return { value, currency: currencyCode(matches[index][2]) };
    }
  }
  return null;
}

function firstAmountFromLine(line: string): ParsedAmount | null {
  const match = line.match(new RegExp(`(${AMOUNT_SOURCE})\\s*(${CURRENCY_SOURCE})?`, "iu"));
  if (!match) return null;
  const value = parseMoney(match[1]);
  return value !== null && Math.abs(value) <= 999_999_999_999.99
    ? { value, currency: currencyCode(match[2]) }
    : null;
}

function amountsFromLine(line: string) {
  return [...line.matchAll(new RegExp(`(${AMOUNT_SOURCE})\\s*(${CURRENCY_SOURCE})?`, "giu"))]
    .map(match => {
      const value = parseMoney(match[1]);
      return value !== null && Math.abs(value) <= 999_999_999_999.99
        ? { value, currency: currencyCode(match[2]) }
        : null;
    })
    .filter((amount): amount is ParsedAmount => amount !== null);
}

function findVatSummary(lines: string[]) {
  const rows = lines.flatMap(line => {
    const match = line.match(/^(?:dph|vat)\s*[:.]?\s*(\d{1,2}(?:[,.]\d{1,2})?)\s*%\s*(.*)$/i);
    if (!match) return [];
    const amounts = amountsFromLine(match[2]);
    if (amounts.length < 3) return [];
    return [{
      rate: parseMoney(match[1]),
      net: amounts[0],
      vat: amounts[amounts.length - 2],
      gross: amounts[amounts.length - 1],
    }];
  }).filter(row => row.rate !== null && vatAmountsMatch(row.net.value, row.rate, row.gross.value));

  if (!rows.length) return null;
  return {
    net: {
      value: roundMoney(rows.reduce((sum, row) => sum + row.net.value, 0)),
      currency: rows.find(row => row.net.currency)?.net.currency ?? rows.find(row => row.gross.currency)?.gross.currency ?? null,
    },
    gross: {
      value: roundMoney(rows.reduce((sum, row) => sum + row.gross.value, 0)),
      currency: rows.find(row => row.gross.currency)?.gross.currency ?? rows.find(row => row.net.currency)?.net.currency ?? null,
    },
    rates: rows.map(row => row.rate as number),
  };
}

function findFirstLabeledAmount(lines: string[], labels: RegExp[]) {
  for (const label of labels) {
    for (let index = 0; index < lines.length; index += 1) {
      if (!label.test(lines[index])) continue;
      const sameLine = firstAmountFromLine(lines[index].replace(label, ""));
      if (sameLine) return sameLine;
      const nextLine = lines[index + 1] ? firstAmountFromLine(lines[index + 1]) : null;
      if (nextLine) return nextLine;
    }
  }
  return null;
}

function findLabeledAmount(lines: string[], labels: RegExp[]) {
  for (const label of labels) {
    for (let index = 0; index < lines.length; index += 1) {
      if (!label.test(lines[index])) continue;
      const sameLine = amountFromLine(lines[index].replace(label, ""));
      if (sameLine) return sameLine;
      const nextLine = lines[index + 1] ? amountFromLine(lines[index + 1]) : null;
      if (nextLine) return nextLine;
    }
  }
  return null;
}

function parseDate(value: string) {
  const iso = value.match(/\b(20\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\b/);
  const local = value.match(/\b(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(20\d{2})\b/);
  const parts = iso ? [iso[1], iso[2], iso[3]] : local ? [local[3], local[2], local[1]] : null;
  if (!parts) return "";
  const result = `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
  return isIsoDate(result) ? result : "";
}

function findLabeledDate(lines: string[], labels: RegExp[]) {
  for (const label of labels) {
    for (let index = 0; index < lines.length; index += 1) {
      if (!label.test(lines[index])) continue;
      const sameLine = parseDate(lines[index].replace(label, ""));
      if (sameLine) return sameLine;
      const nextLine = parseDate(lines[index + 1] ?? "");
      if (nextLine) return nextLine;
    }
  }
  return "";
}

function findValue(lines: string[], labels: RegExp[], valuePattern: RegExp) {
  for (const label of labels) {
    for (let index = 0; index < lines.length; index += 1) {
      if (!label.test(lines[index])) continue;
      const sameLine = lines[index].replace(label, "").match(valuePattern)?.[1];
      if (sameLine) return sameLine;
      const nextLine = (lines[index + 1] ?? "").match(valuePattern)?.[1];
      if (nextLine) return nextLine;
    }
  }
  return "";
}

function findSection(lines: string[], heading: RegExp) {
  const start = lines.findIndex(line => heading.test(line));
  if (start < 0) return [];
  const stop = /^(dodavatel|vystavitel|supplier|platební údaje|bankovní spojení|platba|doprava|datum|produkt|položky|popis|rekapitulace|celkem)\b/i;
  const result: string[] = [];
  const headingMatch = lines[start].match(heading);
  const headingTail = headingMatch?.index === undefined ? "" : lines[start].slice(headingMatch.index + headingMatch[0].length).replace(/^[\s:.-]+/, "");
  if (headingTail) result.push(headingTail);
  for (const line of lines.slice(start + 1, start + 10)) {
    if (stop.test(line)) break;
    result.push(line);
  }
  return result;
}

function uniqueMatches(text: string, pattern: RegExp, normalize: (value: string) => string = value => value) {
  return [...new Set([...text.matchAll(pattern)].map(match => normalize(match[1])).filter(Boolean))];
}

function findCounterparty(lines: string[], text: string, organization: InvoiceOcrOrganization) {
  const detailStart = lines.findIndex(line => /^ODBĚRATEL DETAIL$/i.test(line));
  const detailLines = detailStart >= 0 ? lines.slice(detailStart + 1) : [];
  const detailSection = detailLines.length ? findSection(detailLines, /(odb[ěé]ratel|zákazník|customer|bill to)\b/i) : [];
  const section = detailSection.length ? detailSection : findSection(lines, /(odb[ěé]ratel|zákazník|customer|bill to)\b/i);
  const sectionText = section.join("\n");
  const organizationIco = digits(organization.ico);
  const organizationDic = normalizeComparable(organization.dic).toUpperCase();

  const icoCandidates = uniqueMatches(`${sectionText}\n${text}`, /(?:IČO?|ICO|I[0O]{2}|1[0O]{2}|ID)\s*[:.]?\s*(\d[\d\s]{6,10})/giu, digits)
    .filter(value => value.length === 8 && value !== organizationIco);
  const dicCandidates = uniqueMatches(`${sectionText}\n${text}`, /(?:DIČ|DIC|VAT(?:[ \t]+ID)?)\s*[:.]?\s*([A-Z]{2}[ \t]*[A-Z0-9][A-Z0-9 \t-]{5,18})/giu, value => value.replace(/[\s-]/g, "").toUpperCase())
    .filter(value => value !== organizationDic);
  const emailCandidates = uniqueMatches(sectionText || text, /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/giu, value => value.toLowerCase());

  const ignoredName = /^(?:(?:odb[ěé]ratel|zákazník|customer|bill to)\s*:?[\s.-]*$|(?:ičo|ico|dič|dic|ulice|adresa|tel|telefon|e-mail|email)(?=\s|:|$))/i;
  const name = section.find(line => {
    const normalized = normalizeComparable(line);
    return line.length >= 3 && !ignoredName.test(line) && !/@/.test(line) && !/^\d/.test(line) && normalized !== normalizeComparable(organization.name);
  }) ?? "";

  return {
    name: boundedText(name.replace(/^[\s:.-]+/, ""), 200),
    ico: boundedText(icoCandidates[0], 20),
    dic: boundedText(dicCandidates[0], 24),
    email: boundedText(emailCandidates[0], 254),
  };
}

function documentKind(text: string): OcrDocumentKind {
  if (/dobropis|opravný\s+daňový\s+doklad/i.test(text)) return "credit_note";
  if (/proforma|zálohov[áý]\s+faktura/i.test(text)) return "proforma";
  if (/faktura|f\s+a\s+k\s+t\s+u\s+r\s+a|daňový\s+doklad/i.test(text)) return "issued_invoice";
  return "other";
}

function issuerMatches(text: string, organization: InvoiceOcrOrganization) {
  const textDigits = digits(text);
  const ico = digits(organization.ico);
  if (ico) return textDigits.includes(ico);
  const dic = normalizeComparable(organization.dic);
  if (dic) return normalizeComparable(text).includes(dic);
  const name = normalizeComparable(organization.name);
  return name.length >= 5 ? normalizeComparable(text).includes(name) : null;
}

export function parseInvoiceText({ text: sourceText, fileUrl, organization, ocrConfidence = null, extraWarnings = [] }: {
  text: string;
  fileUrl: string;
  organization: InvoiceOcrOrganization;
  ocrConfidence?: number | null;
  extraWarnings?: string[];
}): InvoiceOcrResult {
  const text = normalizeOcrText(sourceText);
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  const warnings = [...extraWarnings];
  const kind = documentKind(text);
  const issuerMatch = issuerMatches(text, organization);

  const invoiceNumber = findValue(lines,
    [
      /číslo\s+(?:faktury|dokladu)/i,
      /^faktura\s*[:#.-]+\s*(?=[A-Z0-9./_-]*\d)/i,
      /faktura\s*[-–—]?\s*(?:daňový\s+doklad\s*)?(?:č(?:íslo)?\.?|no\.?|number)\s*[:#.-]?/i,
      /faktura\s*[-–—]?\s*(?:danovy\s+doklad\s*)?(?:c\.?|cislo|no\.?|number)\s*[:#.-]?/i,
      /invoice\s*(?:no|number)/i,
    ],
    /([A-Z0-9][A-Z0-9./_-]{2,})/i);
  const variableSymbol = findValue(lines, [/variabilní\s+symbol/i, /var\.?\s*symbol/i, /^VS\b/i], /(\d{3,20})/);
  const issueDate = findLabeledDate(lines, [/datum\s+vystavení/i, /vystaven[oa]/i, /issue\s+date/i]);
  let dueDate = findLabeledDate(lines, [/datum\s+splatnosti/i, /splatnost/i, /due\s+date/i]);
  if (dueDate && issueDate && dueDate < issueDate) {
    warnings.push("Datum splatnosti je dřívější než datum vystavení a nebylo předvyplněno.");
    dueDate = "";
  }

  const vatSummary = findVatSummary(lines);
  const gross = findLabeledAmount(lines, [/celkem\s+k\s+[úu]hrad[ěe]/i, /částka\s+k\s+[úu]hrad[ěe]/i, /k\s+[úu]hrad[ěe]/i, /celkem\s+s\s+dph/i, /grand\s+total/i, /total\s+due/i])
    ?? vatSummary?.gross ?? null;
  const net = vatSummary?.net
    ?? findLabeledAmount(lines, [/celkem\s+bez\s+dph/i, /částka\s+bez\s+dph/i, /základ\s+daně/i, /základ\s+dph/i, /tax\s+base/i, /subtotal/i])
    ?? findFirstLabeledAmount(lines, [/součet\s+položek/i, /souhrn\s+položek/i])
    ?? null;
  const explicitVatRates = uniqueMatches(text, /(?:sazba\s+dph|dph|vat)\s*[:.]?\s*(\d{1,2}(?:[,.]\d{1,2})?)\s*%/giu, value => String(parseMoney(value) ?? ""));
  const vatRecap = text.split(/rekapitulace\s+dph/i)[1] ?? "";
  const recapVatRates = uniqueMatches(vatRecap, /\b(\d{1,2}(?:[,.]\d{1,2})?)\s*%/gu, value => String(parseMoney(value) ?? ""));
  const vatRates = (explicitVatRates.length ? explicitVatRates : recapVatRates.length ? recapVatRates : vatSummary?.rates.map(String) ?? [])
    .map(Number).filter(value => value >= 0 && value <= 100);
  const distinctVatRates = [...new Set(vatRates)];

  let amount = gross?.value ?? 0;
  let amountWithoutVat = net?.value ?? 0;
  let vatRate = distinctVatRates.length === 1 ? distinctVatRates[0] : 0;
  if (amount && amountWithoutVat) {
    const effectiveRate = amount >= amountWithoutVat && amountWithoutVat > 0
      ? roundMoney((amount / amountWithoutVat - 1) * 100)
      : 0;
    if (distinctVatRates.length > 1) {
      vatRate = effectiveRate;
      warnings.push("Faktura obsahuje více sazeb DPH. Předvyplněna je efektivní sazba z celkových částek.");
    } else if (!vatAmountsMatch(amountWithoutVat, vatRate, amount) && effectiveRate >= 0 && effectiveRate <= 100) {
      vatRate = effectiveRate;
      warnings.push("Sazba DPH byla dopočítána z celkových částek; před uložením ji zkontrolujte.");
    }
  } else if (amount && distinctVatRates.length === 1) {
    amountWithoutVat = netFromGross(amount, vatRate);
  } else if (amountWithoutVat && distinctVatRates.length === 1) {
    amount = grossFromNet(amountWithoutVat, vatRate);
  } else if (amount && !amountWithoutVat) {
    amountWithoutVat = amount;
    warnings.push("Základ bez DPH nebyl jednoznačně nalezen. Byla použita stejná částka jako celkem.");
  } else if (amountWithoutVat && !amount) {
    amount = amountWithoutVat;
    warnings.push("Celková částka nebyla jednoznačně nalezena. Byla použita částka bez DPH.");
  }

  const counterparty = findCounterparty(lines, text, organization);
  const currency = gross?.currency ?? net?.currency
    ?? currencyCode(text.match(/(?:^|[\s(])(CZK|Kč|EUR|USD|GBP|PLN|CHF)(?=$|[\s):])/m)?.[1])
    ?? "CZK";

  if (kind !== "issued_invoice") warnings.unshift("Dokument nemusí být běžná vydaná faktura. Před uložením ověřte jeho typ.");
  if (issuerMatch === false) warnings.unshift("Vystavitel dokumentu neodpovídá nastavené firmě. Ověřte, že jde o vydanou fakturu vaší organizace.");
  if (!invoiceNumber) warnings.push("Číslo faktury nebylo rozpoznáno.");
  if (!counterparty.name) warnings.push("Název odběratele nebyl rozpoznán.");
  if (!counterparty.email) warnings.push("E-mail odběratele nebyl rozpoznán a je nutné jej doplnit.");
  if (!amount) warnings.push("Částka k úhradě nebyla rozpoznána.");
  if (!issueDate) warnings.push("Datum vystavení nebylo rozpoznáno.");
  if (!dueDate) warnings.push("Datum splatnosti nebylo rozpoznáno.");

  const required = [invoiceNumber, counterparty.name, counterparty.email, amount > 0, issueDate, dueDate];
  const fieldConfidence = required.filter(Boolean).length / required.length;
  const confidence = Math.max(0, Math.min(1, roundMoney(ocrConfidence === null ? fieldConfidence : fieldConfidence * 0.75 + ocrConfidence / 100 * 0.25)));

  return {
    invoice: {
      invoice_number: boundedText(invoiceNumber, 100),
      counterparty_name: counterparty.name,
      counterparty_ico: counterparty.ico,
      counterparty_dic: counterparty.dic,
      counterparty_email: counterparty.email,
      variable_symbol: boundedText(variableSymbol, 20),
      amount_without_vat: roundMoney(Math.max(0, amountWithoutVat)),
      vat_rate: roundMoney(Math.max(0, vatRate)),
      amount: roundMoney(Math.max(0, amount)),
      currency,
      issue_date: issueDate,
      due_date: dueDate,
      notes: "",
      source: "ocr",
      file_url: fileUrl,
    },
    confidence,
    warnings: [...new Set(warnings.map(warning => boundedText(warning, 240)).filter(Boolean))].slice(0, 12),
    document_kind: kind,
    issuer_matches_organization: issuerMatch,
    model: LOCAL_OCR_MODEL,
    response_id: null,
  };
}
