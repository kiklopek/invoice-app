import type { InvoiceInput } from "../types/invoice";
import { isIsoDate } from "./invoice-validation";
import { grossFromNet, netFromGross, roundMoney, vatAmountsMatch } from "./vat";

export const LOCAL_OCR_MODEL = "local-tesseract-v3-geometry";

export function isOcrHourlyQuotaExceeded(limit: number | null, attempts: number) {
  return limit !== null && attempts >= limit;
}

export type OcrDocumentKind = "issued_invoice" | "proforma" | "credit_note" | "other";

export type OcrReminderPolicyAssignment = {
  status: "remembered" | "default" | "missing_ico";
  counterparty_ico: string | null;
  policy_id: string;
  policy_name: string;
};

export type OcrBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OcrLayoutBlock = OcrBoundingBox & {
  text: string;
  confidence: number | null;
};

export type OcrLayoutLine = {
  page: number;
  line: number;
  text: string;
  source: "pdf_text" | "ocr";
  confidence: number | null;
  bounds: OcrBoundingBox | null;
  blocks: OcrLayoutBlock[];
};

export type OcrDocumentLayout = {
  pages: Array<{
    page: number;
    width: number;
    height: number;
    lines: OcrLayoutLine[];
  }>;
};

export type OcrFieldSource = {
  page: number;
  line: number;
  text: string;
  // "ai" is honest provenance for a field an external AI model answered from
  // its own reading of the document, as opposed to "pdf_text"/"ocr" which
  // point at an exact line this app's own parser matched. Never relabel an
  // AI answer as one of those -- the whole point of field_sources is letting
  // a human reviewer tell "the document says X on this line" apart from
  // "a model said X", and those carry different trust.
  method: "pdf_text" | "ocr" | "derived" | "ai";
  confidence: number | null;
  bounds: OcrBoundingBox | null;
};

export type OcrFieldName =
  | "invoice_number"
  | "variable_symbol"
  | "issue_date"
  | "due_date"
  | "counterparty_name"
  | "counterparty_ico"
  | "counterparty_dic"
  | "counterparty_email"
  | "amount_without_vat"
  | "vat_rate"
  | "amount"
  | "currency";

export type InvoiceOcrResult = {
  invoice: InvoiceInput;
  field_sources: Partial<Record<OcrFieldName, OcrFieldSource>>;
  confidence: number;
  warnings: string[];
  document_kind: OcrDocumentKind;
  issuer_matches_organization: boolean | null;
  reminder_policy_assignment?: OcrReminderPolicyAssignment;
  model: string;
  response_id: string | null;
};

export type InvoiceOcrOrganization = {
  name: string;
  ico: string | null;
  dic: string | null;
};

type ParsedAmount = { value: number; currency: string | null };

// Both alternatives are fenced in by digit boundaries. Without them the
// grouped-thousands alternative happily matches a *prefix* of a longer plain
// number -- "2026" in a sentence became "202" + a leftover "6", and an 8-digit
// I\u010cO became four junk fragments -- so whichever amount got picked last was
// whatever fell off the end of an unrelated number.
const AMOUNT_SOURCE =
  "(?<!\\d)-?\\d{1,3}(?:[ .\u00a0]\\d{3})*(?:[,.]\\d{1,2})?(?!\\d)|(?<!\\d)-?\\d+(?:[,.]\\d{1,2})?(?!\\d)";
const CURRENCY_SOURCE = "CZK|Kč|EUR|USD|GBP|PLN|CHF";

export function boundedText(value: string | null | undefined, max: number) {
  return (value ?? "").trim().slice(0, max);
}

function normalizeComparable(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("cs")
    .replace(/[^a-z0-9]/g, "");
}

// Every label regex below is written unaccented and matched against this
// stripped/lowercased form of each line, not the original text. Invoices from
// outside this app's own template use endless label wording variants
// ("Vystaveno dne" vs "Datum vystaven\u00ed" vs "Issue date"...), and OCR itself
// frequently mangles Czech diacritics first -- matching case/diacritic
// -insensitively is the single highest-leverage way to keep recognizing
// labels across unfamiliar layouts, without needing to enumerate every
// accented spelling separately. The actual value (an invoice number, a name,
// an amount...) is still always read out of the original, unstripped line --
// see labeledRemainder/findSection below -- so accents and letter case in the
// extracted value itself are never lost.
function stripDiacritics(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
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

const VAT_TABLE_HEADER_ROW = /^sazba\s+dph/;
const VAT_TABLE_BASE_ROW = /^zaklad\s+dane/;
const VAT_TABLE_OUT_OF_SCOPE_COLUMN = /neni\s+predmetem/;
const VAT_TABLE_TOTAL_COLUMN = /^celkem\b/;
const VAT_TABLE_RATE_IN_HEADER = /(\d{1,2}(?:[,.]\d{1,2})?)\s*%/;

type VatTableColumn = { rightEdge: number; rate: number | null; outOfScope: boolean; isTotal: boolean };

// Same root cause as the Dodavatel/Odběratel column mix-up handled by
// findCounterparty below, just applied to a numeric table instead of a
// counterparty section: a multi-rate VAT recap table (Není předmětem DPH |
// Osvobozeno 0% | Snížená | Základní 21% | Celkem) that layoutPdfPage
// reconstructs onto one merged text line leaves several numbers on that
// line, and pickPlausibleAmount above can only ever guess at ONE of them.
// When real per-token geometry is available we don't have to guess: checked
// against two real invoices' actual PDF geometry, a numeric cell's RIGHT
// edge (x + width) -- not its left edge, which drifts under wide headers
// like "Není předmětem" -- lines up almost exactly with its own column
// header's right edge, because both are right-aligned to the same column
// boundary. That gives an exact, per-document column assignment instead of
// a positional guess.
function findVatBreakdownTable(layout: OcrDocumentLayout): { net: ParsedAmount; vatRate: number } | null {
  for (const page of layout.pages) {
    for (let index = 0; index < page.lines.length; index += 1) {
      const headerLine = page.lines[index];
      if (!VAT_TABLE_HEADER_ROW.test(stripDiacritics(headerLine.text))) continue;
      const columns: VatTableColumn[] = headerLine.blocks
        .filter(block => !VAT_TABLE_HEADER_ROW.test(stripDiacritics(block.text)))
        .map(block => {
          const stripped = stripDiacritics(block.text);
          const rateMatch = block.text.match(VAT_TABLE_RATE_IN_HEADER);
          return {
            rightEdge: block.x + block.width,
            outOfScope: VAT_TABLE_OUT_OF_SCOPE_COLUMN.test(stripped),
            isTotal: !rateMatch && VAT_TABLE_TOTAL_COLUMN.test(stripped),
            rate: rateMatch ? parseMoney(rateMatch[1]) : null,
          };
        });
      if (columns.length < 2) continue;

      const baseLine = page.lines.slice(index + 1, index + 6).find(line => VAT_TABLE_BASE_ROW.test(stripDiacritics(line.text)));
      if (!baseLine) continue;

      const assigned = baseLine.blocks
        .map(block => ({ amount: firstAmountFromLine(block.text), rightEdge: block.x + block.width }))
        .filter((entry): entry is { amount: ParsedAmount; rightEdge: number } => entry.amount !== null)
        .map(entry => ({
          amount: entry.amount,
          column: columns.reduce((closest, column) =>
            Math.abs(column.rightEdge - entry.rightEdge) < Math.abs(closest.rightEdge - entry.rightEdge) ? column : closest),
        }));

      // Only trust this when it's unambiguous: exactly one column that's a
      // real, known rate (not the out-of-scope or total column) with money
      // in it. Zero such columns (nothing matched cleanly) or more than one
      // (a genuine multi-rate invoice) both fall through to the existing
      // plausibility/effective-rate handling instead of guessing here.
      const candidates = assigned.filter(entry => !entry.column.outOfScope && !entry.column.isTotal && entry.column.rate !== null && entry.amount.value > 0);
      if (candidates.length !== 1) continue;
      // The rate column tells us WHICH rate applies, but it isn't the whole
      // base: a "Není předmětem DPH" remainder sits in its own column and the
      // document sums both in its own "Celkem" column (12 942,00 + 0,18 =
      // 12 942,18, which is exactly what plus the tax makes the stated total).
      // Taking the rate column alone silently dropped those haléře, so prefer
      // the document's own total whenever it's there and at least as large.
      const documentBase = assigned.find(entry => entry.column.isTotal);
      const net = documentBase && documentBase.amount.value >= candidates[0].amount.value
        ? documentBase.amount
        : candidates[0].amount;
      return { net, vatRate: candidates[0].column.rate as number };
    }
  }
  return null;
}

// Labels are matched against the diacritic-stripped `strippedLines` array so
// broadened, unaccented label vocabulary works regardless of OCR/PDF accent
// fidelity; the remainder text used to extract the actual value always comes
// from the corresponding *original* `lines` entry (sliced at the label
// match's end offset -- diacritic stripping never changes Czech character
// count, so the offsets line up) so amount currency symbols like "Kč" and
// any accented characters in the value itself are never corrupted.
function labeledRemainder(lines: string[], strippedLines: string[], label: RegExp, index: number): string | null {
  const match = strippedLines[index]?.match(label);
  if (!match) return null;
  const offset = (match.index ?? 0) + match[0].length;
  return lines[index].slice(offset);
}

// An item table's heading row ("Text Množství DPH Cena Celkem bez DPH Celkem
// s DPH") contains the very same wording as a total's label, but no amount --
// so a money search that matched it would either grab the first item's figure
// or, worse, spill onto whatever line follows. Such a row is recognisable by
// having no digits at all while stacking several column words; a genuine
// label line ("Celkem bez DPH" with its amount on the next line) has at most
// a couple, so it keeps working.
const TABLE_HEADING_WORDS = /\b(?:text|popis|polozka|mnozstvi|pocet|cena|sazba|zaklad|dph|celkem|jednotka|mj|kus)\b/g;
function looksLikeTableHeading(strippedLine: string | undefined) {
  if (!strippedLine) return false;
  // A column heading can bake its own rate into the label, e.g. "Základ DPH
  // 21 % Celkem" -- the "21" there is describing the DPH column, not an
  // amount on a label:amount line. Strip "N %" before the digit check so
  // this still reads as digit-free, otherwise "zaklad dph" in it matches the
  // net-amount label search, sees a lone "21" leaking through with no
  // amount before it, and treats the RATE as if it were the net total.
  const withoutRatePercent = strippedLine.replace(/\d+(?:[,.]\d+)?\s*%/g, "");
  if (/\d/.test(withoutRatePercent)) return false;
  return (strippedLine.match(TABLE_HEADING_WORDS) ?? []).length >= 3;
}

function amountLabelRemainder(lines: string[], strippedLines: string[], label: RegExp, index: number) {
  if (looksLikeTableHeading(strippedLines[index])) return null;
  return labeledRemainder(lines, strippedLines, label, index);
}

function findFirstLabeledAmount(lines: string[], strippedLines: string[], labels: RegExp[]) {
  for (const label of labels) {
    for (let index = 0; index < lines.length; index += 1) {
      const remainder = amountLabelRemainder(lines, strippedLines, label, index);
      if (remainder === null) continue;
      const sameLine = firstAmountFromLine(remainder);
      if (sameLine) return sameLine;
      const nextLine = lines[index + 1] ? firstAmountFromLine(lines[index + 1]) : null;
      if (nextLine) return nextLine;
    }
  }
  return null;
}

function findLabeledAmount(lines: string[], strippedLines: string[], labels: RegExp[]) {
  for (const label of labels) {
    for (let index = 0; index < lines.length; index += 1) {
      const remainder = amountLabelRemainder(lines, strippedLines, label, index);
      if (remainder === null) continue;
      const sameLine = amountFromLine(remainder);
      if (sameLine) return sameLine;
      const nextLine = lines[index + 1] ? amountFromLine(lines[index + 1]) : null;
      if (nextLine) return nextLine;
    }
  }
  return null;
}

// Same as above but without the next-line fallback. A wording like "Celkem s
// DPH" is not only a total's label -- it's also a column heading in the item
// table, where the number underneath belongs to the first item (or, worse,
// isn't a number at all and the search spills into a sentence). A real total
// always carries its amount on its own line, so for total-style labels the
// stricter lookup is the safe one.
function findLabeledAmountOnSameLine(lines: string[], strippedLines: string[], labels: RegExp[]) {
  for (const label of labels) {
    for (let index = 0; index < lines.length; index += 1) {
      const remainder = amountLabelRemainder(lines, strippedLines, label, index);
      if (remainder === null) continue;
      const sameLine = amountFromLine(remainder);
      if (sameLine) return sameLine;
    }
  }
  return null;
}

// A multi-rate VAT breakdown table (Není předmětem DPH | Osvobozeno 0% |
// Snížená | Základní 21% | Celkem) that gets merged onto one text row (same
// row-by-Y-position reconstruction issue as the Dodavatel/Odběratel mix-up
// fixed in findCounterparty above) leaves several numbers on the labeled
// "Základ daně"/"Celkem bez DPH" line -- a fixed position (first/last) then
// just picks whichever column happens to sit there, e.g. a tiny "not subject
// to VAT" rounding remainder instead of the real base. When there's more
// than one candidate on the line, prefer whichever one, combined with the
// already-found gross total, implies a real VAT rate -- ideally one already
// seen elsewhere on the document, otherwise just a plausible 0-100% one --
// over blindly trusting position. With only one candidate (the common,
// already-correct case) or no known gross to compare against, this is
// identical to the plain last-match behavior above.
function pickPlausibleAmount(candidates: ParsedAmount[], gross: number | null, explicitVatRates: number[]): ParsedAmount | null {
  if (!candidates.length) return null;
  if (candidates.length === 1 || gross === null) return candidates[candidates.length - 1];
  const scored = candidates.map(candidate => ({
    candidate,
    rate: candidate.value > 0 ? roundMoney((gross / candidate.value - 1) * 100) : null,
  }));
  const explicitMatch = scored.find(entry => entry.rate !== null && explicitVatRates.some(rate => Math.abs(rate - entry.rate!) < 0.5));
  if (explicitMatch) return explicitMatch.candidate;
  const plausible = scored.find(entry => entry.rate !== null && entry.rate >= 0 && entry.rate <= 100);
  if (plausible) return plausible.candidate;
  return candidates[candidates.length - 1];
}

function findPlausibleNetAmount(
  lines: string[],
  strippedLines: string[],
  labels: RegExp[],
  gross: number | null,
  explicitVatRates: number[],
) {
  for (const label of labels) {
    for (let index = 0; index < lines.length; index += 1) {
      const remainder = amountLabelRemainder(lines, strippedLines, label, index);
      if (remainder === null) continue;
      const sameLine = pickPlausibleAmount(amountsFromLine(remainder), gross, explicitVatRates);
      if (sameLine) return sameLine;
      const nextLine = lines[index + 1] ? pickPlausibleAmount(amountsFromLine(lines[index + 1]), gross, explicitVatRates) : null;
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

function findLabeledDate(lines: string[], strippedLines: string[], labels: RegExp[]) {
  for (const label of labels) {
    for (let index = 0; index < lines.length; index += 1) {
      const remainder = labeledRemainder(lines, strippedLines, label, index);
      if (remainder === null) continue;
      const sameLine = parseDate(remainder);
      if (sameLine) return sameLine;
      const nextLine = parseDate(lines[index + 1] ?? "");
      if (nextLine) return nextLine;
    }
  }
  return "";
}

function findValue(lines: string[], strippedLines: string[], labels: RegExp[], valuePattern: RegExp, requireDigit = false) {
  const globalPattern = new RegExp(valuePattern.source, valuePattern.flags.includes("g") ? valuePattern.flags : `${valuePattern.flags}g`);
  const firstValidMatch = (text: string) => {
    for (const match of text.matchAll(globalPattern)) {
      const candidate = match[1];
      if (candidate && (!requireDigit || /\d/.test(candidate))) return candidate;
    }
    return undefined;
  };
  for (const label of labels) {
    for (let index = 0; index < lines.length; index += 1) {
      const remainder = labeledRemainder(lines, strippedLines, label, index);
      if (remainder === null) continue;
      const sameLine = firstValidMatch(remainder);
      if (sameLine) return sameLine;
      const nextLine = firstValidMatch(lines[index + 1] ?? "");
      if (nextLine) return nextLine;
    }
  }
  return "";
}

// Section headings and their "stop" boundaries are detected against the
// diacritic-stripped/lowercased line (strippedLines), so wording variants and
// OCR-mangled accents both still match; the actual text pushed into the
// result comes from the original `lines` array at the same index, so names,
// addresses etc. keep their real accents.
//
// Word lists are shared (as plain alternation strings, not compiled regexes)
// between the issuer side and the counterparty side so each can be used both
// as a positive heading match and as the OTHER side's section-boundary stop
// word -- a document's "Dodavatel" block ends where its "Odběratel" block
// begins, and vice versa.
const ISSUER_HEADING_WORDS = "dodavatel|vystavitel|supplier|seller|vendor|issuer|prodejce";
const COUNTERPARTY_HEADING_WORDS = "odberatel|zakaznik|customer|bill\\s*to|sold\\s*to|invoice\\s*to|klient|kupujici|purchaser|objednatel";
const GENERIC_SECTION_STOP_WORDS = "platebni\\s+udaje|bankovni\\s+spojeni|platba|doprava|datum|produkt|polozky|popis|rekapitulace|celkem|iban|swift|bic";
const SECTION_STOP = new RegExp(`^(${ISSUER_HEADING_WORDS}|${GENERIC_SECTION_STOP_WORDS})\\b`);
const ISSUER_SECTION_STOP = new RegExp(`^(${COUNTERPARTY_HEADING_WORDS}|${GENERIC_SECTION_STOP_WORDS})\\b`);

function findSection(lines: string[], strippedLines: string[], heading: RegExp, stop: RegExp = SECTION_STOP) {
  const start = strippedLines.findIndex(line => heading.test(line));
  if (start < 0) return [];
  const result: string[] = [];
  const headingMatch = strippedLines[start].match(heading);
  const headingTail = headingMatch?.index === undefined ? "" : lines[start].slice(headingMatch.index + headingMatch[0].length).replace(/^[\s:.-]+/, "");
  if (headingTail) result.push(headingTail);
  for (let index = start + 1; index < Math.min(lines.length, start + 10); index += 1) {
    if (stop.test(strippedLines[index])) break;
    result.push(lines[index]);
  }
  return result;
}

function uniqueMatches(text: string, pattern: RegExp, normalize: (value: string) => string = value => value) {
  return [...new Set([...text.matchAll(pattern)].map(match => normalize(match[1])).filter(Boolean))];
}

// Unaccented, matched against strippedLines. Broad on purpose: invoices
// outside this app's own template label the customer section as anything
// from "Odběratel" to "Klient", "Kupující" or plain English "Bill to"/"Sold
// to"/"Customer".
const COUNTERPARTY_HEADING = new RegExp(`(${COUNTERPARTY_HEADING_WORDS})\\b`);
const ISSUER_HEADING = new RegExp(`(${ISSUER_HEADING_WORDS})\\b`);
const IGNORED_NAME_LINE = new RegExp(`^(?:(?:${COUNTERPARTY_HEADING_WORDS})\\s*:?[\\s.-]*$|(?:ico|dic|vat|ulice|adresa|street|address|tel|telefon|phone|e-?mail)(?=\\s|:|$))`);

const ICO_PATTERN = /(?:IČO?|ICO|I[0O]{2}|1[0O]{2}|ID)\s*[:.]?\s*(\d[\d\s]{6,10})/giu;
const DIC_PATTERN = /(?:DIČ|DIC|VAT(?:[ \t]+ID)?)\s*[:.]?\s*([A-Z]{2}[ \t]*[A-Z0-9][A-Z0-9 \t-]{5,18})/giu;
const EMAIL_PATTERN = /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/giu;

// A single company/account in this app can legitimately issue invoices under
// more than one real legal identity (e.g. a sole trader/OSVČ for some
// invoices, one or more s.r.o. companies for others) -- Settings only stores
// one configured `organization` identity, so relying on it alone to say
// "this is us" fails for every invoice issued under any of the others. This
// finds whatever the DOCUMENT ITSELF labels as the issuer (Dodavatel/
// Vystavitel/Supplier/...), independent of the configured organization, so
// its IČO/DIČ/name can be excluded from counterparty candidates purely
// structurally.
function findIssuerSection(lines: string[], strippedLines: string[]) {
  return findSection(lines, strippedLines, ISSUER_HEADING, ISSUER_SECTION_STOP);
}

// Two-column invoice templates (Dodavatel box left, Odběratel box right) are
// the single biggest source of wrong counterparty IČO/DIČ: `layoutPdfPage`
// reconstructs reading order by grouping PDF text items into rows purely by Y
// position, so once the two boxes' line counts drift out of sync (a longer
// company name, an extra "Zápis v obchodním rejstříku" line, ...), a later row
// ends up pairing the ISSUER's own IČ/DIČ with the COUNTERPARTY's address on
// one merged text line -- e.g. "IČ: 66151023 Hradecká 1116". The section/
// stop-word heuristic above has no way to catch this: the issuer's real
// IČO/DIČ physically sit past the point where the "Odběratel" heading already
// triggered the section stop, so they're never excluded and can even be found
// *before* the genuine counterparty value in the reconstructed text stream.
//
// The fix only text alone cannot provide: use the ORIGINAL per-token x
// position that PDF text extraction (and, for photographed/scanned invoices,
// per-word OCR bounding boxes) still carries in `layout`, even after two
// unrelated columns get joined into one display line. Whichever heading
// ("Dodavatel"/"Odběratel") a candidate value sits horizontally closer to is
// its true owner, regardless of which text line it was reconstructed onto.
function findHeadingBlockX(layout: OcrDocumentLayout | undefined, heading: RegExp): number | null {
  if (!layout) return null;
  for (const page of layout.pages) {
    for (const line of page.lines) {
      for (const block of line.blocks) {
        if (heading.test(stripDiacritics(block.text))) return block.x;
      }
    }
  }
  return null;
}

function findValueBlockX(layout: OcrDocumentLayout | undefined, value: string): number | null {
  if (!layout || !value) return null;
  const compact = value.replace(/[\s-]/g, "").toUpperCase();
  if (!compact) return null;
  for (const page of layout.pages) {
    for (const line of page.lines) {
      for (const block of line.blocks) {
        if (block.text.replace(/[\s-]/g, "").toUpperCase().includes(compact)) return block.x;
      }
    }
  }
  return null;
}

function findCounterparty(
  lines: string[],
  strippedLines: string[],
  text: string,
  organization: InvoiceOcrOrganization,
  issuerSection: string[],
  layout?: OcrDocumentLayout,
) {
  const detailStart = strippedLines.findIndex(line => /^odberatel\s+detail$/.test(line));
  const detailLines = detailStart >= 0 ? lines.slice(detailStart + 1) : [];
  const detailStrippedLines = detailStart >= 0 ? strippedLines.slice(detailStart + 1) : [];
  const detailSection = detailLines.length ? findSection(detailLines, detailStrippedLines, COUNTERPARTY_HEADING) : [];
  const section = detailSection.length ? detailSection : findSection(lines, strippedLines, COUNTERPARTY_HEADING);
  const sectionText = section.join("\n");
  const organizationIco = digits(organization.ico);
  const organizationDic = normalizeComparable(organization.dic).toUpperCase();

  const issuerSectionText = issuerSection.join("\n");
  const issuerIcos = new Set(uniqueMatches(issuerSectionText, ICO_PATTERN, digits).filter(value => value.length === 8));
  const issuerDics = new Set(uniqueMatches(issuerSectionText, DIC_PATTERN, value => value.replace(/[\s-]/g, "").toUpperCase()));
  const issuerNames = new Set(issuerSection.map(line => normalizeComparable(line)).filter(Boolean));
  const issuerEmails = new Set(uniqueMatches(issuerSectionText, EMAIL_PATTERN, value => value.toLowerCase()));

  // Only trust column position when the document actually has two distinct,
  // horizontally separated headings to compare against -- a single-column
  // template, or a layout without word-level geometry (fallbackLayout, plain
  // text-only callers/tests), leaves both null/close and this is skipped, so
  // behavior for those stays exactly as before.
  const issuerHeadingX = findHeadingBlockX(layout, ISSUER_HEADING);
  const counterpartyHeadingX = findHeadingBlockX(layout, COUNTERPARTY_HEADING);
  const columnsDiffer = issuerHeadingX !== null && counterpartyHeadingX !== null && Math.abs(issuerHeadingX - counterpartyHeadingX) > 0.15;
  const belongsToIssuerColumn = (value: string) => {
    if (!columnsDiffer) return false;
    const x = findValueBlockX(layout, value);
    if (x === null) return false;
    return Math.abs(x - issuerHeadingX!) < Math.abs(x - counterpartyHeadingX!);
  };

  const icoCandidates = uniqueMatches(`${sectionText}\n${text}`, ICO_PATTERN, digits)
    .filter(value => value.length === 8 && value !== organizationIco && !issuerIcos.has(value) && !belongsToIssuerColumn(value));
  const dicCandidates = uniqueMatches(`${sectionText}\n${text}`, DIC_PATTERN, value => value.replace(/[\s-]/g, "").toUpperCase())
    .filter(value => value !== organizationDic && !issuerDics.has(value) && !belongsToIssuerColumn(value));
  // The e-mail used to be the one counterparty field with no supplier guard at
  // all: it fell back to the first address anywhere in the document, which on a
  // single-column template is the SUPPLIER's. That address then rode into the
  // customer registry and produced customers that are really us. Guard it the
  // same way the ICO and DIC are guarded. Finding nothing is the better
  // outcome -- the caller already warns that the e-mail needs to be filled in.
  const emailCandidates = uniqueMatches(sectionText || text, EMAIL_PATTERN, value => value.toLowerCase())
    .filter(value => !issuerEmails.has(value) && !belongsToIssuerColumn(value));

  const name = section.find(line => {
    const strippedLine = stripDiacritics(line);
    const normalized = normalizeComparable(line);
    return line.length >= 3 && !IGNORED_NAME_LINE.test(strippedLine) && !/@/.test(line) && !/^\d/.test(line)
      && normalized !== normalizeComparable(organization.name)
      && !issuerNames.has(normalized);
  }) ?? "";

  return {
    name: boundedText(name.replace(/^[\s:.-]+/, ""), 200),
    ico: boundedText(icoCandidates[0], 20),
    dic: boundedText(dicCandidates[0], 24),
    email: boundedText(emailCandidates[0], 254),
  };
}

function documentKind(strippedText: string): OcrDocumentKind {
  if (/dobropis|opravny\s+danovy\s+doklad|credit\s+note/.test(strippedText)) return "credit_note";
  if (/proforma|zalohov[ay]\s+faktura|pro\s*forma/.test(strippedText)) return "proforma";
  if (/faktura|f\s+a\s+k\s+t\s+u\s+r\s+a|danovy\s+doklad|invoice|tax\s+document/.test(strippedText)) return "issued_invoice";
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

function fallbackLayout(text: string): OcrDocumentLayout {
  return {
    pages: [{
      page: 1,
      width: 0,
      height: 0,
      lines: text.split("\n").map((line, index) => ({
        page: 1,
        line: index + 1,
        text: line,
        source: "ocr" as const,
        confidence: null,
        bounds: null,
        blocks: [],
      })),
    }],
  };
}

function sourceFromLine(line: OcrLayoutLine, method: OcrFieldSource["method"] = line.source): OcrFieldSource {
  return {
    page: line.page,
    line: line.line,
    text: boundedText(line.text, 300),
    method,
    confidence: line.confidence === null ? null : Math.max(0, Math.min(1, roundMoney(line.confidence / 100))),
    bounds: line.bounds,
  };
}

function bestSource(
  layout: OcrDocumentLayout,
  value: string | number,
  options: { labels?: RegExp; kind?: "text" | "digits" | "date" | "amount" } = {},
) {
  if (value === "" || value === 0) return null;
  const lines = layout.pages.flatMap(page => page.lines);
  const kind = options.kind ?? "text";
  const comparable = normalizeComparable(String(value));
  const numeric = typeof value === "number" ? value : null;
  let selected: { line: OcrLayoutLine; score: number } | null = null;

  for (const line of lines) {
    let score = options.labels?.test(stripDiacritics(line.text)) ? 40 : 0;
    if (kind === "date") score += parseDate(line.text) === value ? 80 : 0;
    else if (kind === "amount" && numeric !== null) {
      score += amountsFromLine(line.text).some(amount => Math.abs(amount.value - numeric) < 0.011) ? 80 : 0;
    } else if (kind === "digits") {
      const sought = digits(String(value));
      score += sought && digits(line.text).includes(sought) ? 80 : 0;
    } else {
      score += comparable.length >= 2 && normalizeComparable(line.text).includes(comparable) ? 80 : 0;
    }
    if (score > 40 && (!selected || score > selected.score)) selected = { line, score };
  }
  return selected ? sourceFromLine(selected.line) : null;
}

// Each of these warnings is only true at the moment OCR ran -- nothing
// re-runs it as the accountant fills a field in by hand afterwards, so
// without this the review screen would keep telling them a field "wasn't
// recognized" even after they've just typed it in themselves. Keying each
// warning to the InvoiceInput field it's actually about (single source of
// truth with the `warnings.push(...)` calls below) lets the UI drop it live
// once that field has a value, while every other warning here -- issuer
// mismatch, VAT rate ambiguity, document type -- isn't a simple "is this
// field empty" check and is left alone.
export const OCR_MISSING_FIELD_WARNING: Partial<Record<keyof InvoiceInput, string>> = {
  invoice_number: "Číslo faktury nebylo rozpoznáno.",
  counterparty_name: "Název odběratele nebyl rozpoznán.",
  counterparty_email: "E-mail odběratele nebyl rozpoznán a je nutné jej doplnit.",
  counterparty_ico: "IČO odběratele nebylo rozpoznáno.",
  amount: "Částka k úhradě nebyla rozpoznána.",
  issue_date: "Datum vystavení nebylo rozpoznáno.",
  due_date: "Datum splatnosti nebylo rozpoznáno.",
};

export function relevantOcrWarnings(warnings: string[], invoice: InvoiceInput): string[] {
  const fieldWarnings = Object.entries(OCR_MISSING_FIELD_WARNING) as Array<[keyof InvoiceInput, string]>;
  return warnings.filter(warning => {
    const entry = fieldWarnings.find(([, text]) => text === warning);
    if (!entry) return true;
    const value = invoice[entry[0]];
    return typeof value === "number" ? !(value > 0) : !(typeof value === "string" && value.trim());
  });
}

export function parseInvoiceText({ text: sourceText, fileUrl, organization, ocrConfidence = null, extraWarnings = [], layout }: {
  text: string;
  fileUrl: string;
  organization: InvoiceOcrOrganization;
  ocrConfidence?: number | null;
  extraWarnings?: string[];
  layout?: OcrDocumentLayout;
}): InvoiceOcrResult {
  const text = normalizeOcrText(sourceText);
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  // Label matching runs against this diacritic-stripped, lowercased parallel
  // array (see stripDiacritics above) so wording variants and OCR-mangled
  // accents both still match; values (digits, amounts, dates) are read from
  // the same stripped line since none of them are accent-sensitive.
  const strippedLines = lines.map(stripDiacritics);
  const strippedText = strippedLines.join("\n");
  const warnings = [...extraWarnings];
  const kind = documentKind(strippedText);
  const issuerMatch = issuerMatches(text, organization);
  const documentLayout = layout ?? fallbackLayout(text);

  const invoiceNumber = findValue(lines, strippedLines,
    [
      /cislo\s+(?:faktury|dokladu|dd)/,
      /^faktura\s*[:#.-]+\s*(?=[a-z0-9./_-]*\d)/,
      /\bfa\.?\s*(?:c\.?|cislo)\s*[:#.-]?/,
      /\bfaktura\b\s*[-–—]?\s*(?:danovy\s+doklad\s*)?(?:c(?:islo)?\.?|no\.?|number|#)\s*[:#.-]?/,
      /\bdanovy\s+doklad\b\s*(?:c(?:islo)?\.?|no\.?)?\s*[:#.-]?/,
      /\bdoklad\b\s*(?:c(?:islo)?\.?|no\.?)\s*[:#.-]?/,
      /\binvoice\b\s*(?:no\.?|number|#)/,
      /\binv\.?\s*(?:no\.?|#)\b/,
    ],
    /([A-Z0-9][A-Z0-9./_-]{2,})/i,
    // A real invoice number always has at least one digit. Without this, a
    // label match on a line whose actual number lives elsewhere (e.g. two
    // PDF columns collapsed onto one text line by layout reconstruction)
    // could pick up a neighboring plain word instead -- e.g. "Dodavatel"
    // ("Supplier") on an invoice layout that isn't this app's own template.
    true);
  const variableSymbol = findValue(lines, strippedLines, [/variabilni\s+symbol/, /\bvar\.?\s*symbol/, /^vs\b/, /\bv\.?s\.?\s*[:#.-]/], /(\d{3,20})/);
  const issueDate = findLabeledDate(lines, strippedLines, [
    /datum\s+vystaveni/, /den\s+vystaveni/, /vystaveno\s+dne/, /vystaven[oa]/, /vydano\s+dne/,
    /issue\s*date/, /date\s+of\s+issue/, /invoice\s+date/,
  ]);
  let dueDate = findLabeledDate(lines, strippedLines, [
    /datum\s+splatnosti/, /splatnost/, /splatn[ae]\s+dne/, /uhradte\s+do/, /splatit\s+do/,
    /due\s*date/, /payment\s+due/, /maturity\s+date/,
  ]);
  if (dueDate && issueDate && dueDate < issueDate) {
    warnings.push("Datum splatnosti je dřívější než datum vystavení a nebylo předvyplněno.");
    dueDate = "";
  }

  const vatSummary = findVatSummary(lines);
  const dueAmount = findLabeledAmount(lines, strippedLines, [/celkem\s+k\s+uhrad[ae]/, /castka\s+k\s+uhrad[ae]/, /k\s+uhrad[ae]/, /amount\s+due/, /balance\s+due/]);
  // A document total may legitimately exceed what's left to pay (prepayments),
  // which is what initial_paid below is derived from -- but it can never be
  // *less*. Anything smaller than the amount due is a mis-read label, not a
  // total, so it's dropped rather than allowed to outrank "K úhradě".
  const labelledTotal = findLabeledAmountOnSameLine(lines, strippedLines, [/celkem\s+s\s+dph/, /celkova\s+hodnota/, /grand\s+total/]);
  const documentTotal = labelledTotal && (!dueAmount || labelledTotal.value >= dueAmount.value) ? labelledTotal : null;
  const gross = documentTotal ?? findLabeledAmount(lines, strippedLines, [
    /celkem\s+k\s+uhrad[ae]/, /castka\s+k\s+uhrad[ae]/, /k\s+uhrad[ae]/, /celkem\s+s\s+dph/,
    /celkem\s+k\s+platb[ae]/, /k\s+proplaceni/, /celkem\s+kc/,
    /grand\s+total/, /total\s+due/, /total\s+amount/, /amount\s+due/, /balance\s+due/,
  ]) ?? vatSummary?.gross ?? null;
  const vatTable = findVatBreakdownTable(documentLayout);
  const explicitVatRates = uniqueMatches(text, /(?:sazba\s+dph|dph|vat)\s*[:.]?\s*(\d{1,2}(?:[,.]\d{1,2})?)\s*%/giu, value => String(parseMoney(value) ?? ""));
  const vatRecap = text.split(/rekapitulace\s+dph/i)[1] ?? "";
  const recapVatRates = uniqueMatches(vatRecap, /\b(\d{1,2}(?:[,.]\d{1,2})?)\s*%/gu, value => String(parseMoney(value) ?? ""));
  const vatRates = (explicitVatRates.length ? explicitVatRates : recapVatRates.length ? recapVatRates : vatSummary?.rates.map(String) ?? [])
    .map(Number).filter(value => value >= 0 && value <= 100);
  const distinctVatRates = vatTable ? [vatTable.vatRate] : [...new Set(vatRates)];
  const net = vatTable?.net
    ?? vatSummary?.net
    ?? findPlausibleNetAmount(lines, strippedLines, [
      /celkem\s+bez\s+dph/, /castka\s+bez\s+dph/, /cena\s+bez\s+dph/, /zaklad\s+dane/, /zaklad\s+dph/,
      /tax\s+base/, /subtotal/, /net\s+amount/, /mezisoucet/,
    ], gross?.value ?? null, distinctVatRates)
    ?? findFirstLabeledAmount(lines, strippedLines, [/soucet\s+polozek/, /souhrn\s+polozek/])
    ?? null;

  let amount = gross?.value ?? 0;
  let amountWithoutVat = net?.value ?? 0;
  let vatRate = distinctVatRates.length === 1 ? distinctVatRates[0] : 0;
  if (amount && amountWithoutVat) {
    const effectiveRate = amountWithoutVat > 0 ? roundMoney((amount / amountWithoutVat - 1) * 100) : -1;
    // A real Czech VAT rate never exceeds ~30%. If the captured "net" total
    // implies anything wildly outside that, it almost certainly isn't the
    // real subtotal at all (e.g. a quantity or item count picked up from an
    // unfamiliar invoice layout) rather than a genuine multi-rate invoice --
    // trust the (more specifically labeled) gross total instead of silently
    // showing a nonsensical net/rate pair.
    const plausible = effectiveRate >= 0 && effectiveRate <= 100;
    if (!plausible) {
      amountWithoutVat = amount;
      vatRate = distinctVatRates.length === 1 ? distinctVatRates[0] : 0;
      warnings.push("Základ bez DPH nebyl spolehlivě rozpoznán (nalezená hodnota neodpovídala celkové částce). Zkontrolujte a doplňte správnou částku bez DPH.");
    } else if (distinctVatRates.length > 1) {
      vatRate = effectiveRate;
      warnings.push("Faktura obsahuje více sazeb DPH. Předvyplněna je efektivní sazba z celkových částek.");
    } else if (!vatAmountsMatch(amountWithoutVat, vatRate, amount)) {
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

  const issuerSection = findIssuerSection(lines, strippedLines);
  const counterparty = findCounterparty(lines, strippedLines, text, organization, issuerSection, documentLayout);
  const currency = gross?.currency ?? net?.currency
    ?? currencyCode(text.match(/(?:^|[\s(])(CZK|Kč|EUR|USD|GBP|PLN|CHF)(?=$|[\s):])/m)?.[1])
    ?? "CZK";

  if (kind !== "issued_invoice") warnings.unshift("Dokument nemusí být běžná vydaná faktura. Před uložením ověřte jeho typ.");
  // A mismatch here is expected and harmless for a business that legitimately
  // invoices under more than one legal identity (a sole trader/OSVČ alongside
  // one or more s.r.o. companies, say) -- findCounterparty already handles
  // that structurally via the document's own Dodavatel/Vystavitel section, so
  // this stays an informational nudge to double-check rather than an implied
  // error.
  if (issuerMatch === false) warnings.unshift("Vystavitel dokumentu neodpovídá firmě nastavené v Nastavení. Pokud fakturujete i pod jinou firmou nebo jako OSVČ/fyzická osoba, může to být v pořádku – jinak zkontrolujte, že jde o vydanou fakturu vaší organizace.");
  if (!invoiceNumber) warnings.push(OCR_MISSING_FIELD_WARNING.invoice_number!);
  if (!counterparty.name) warnings.push(OCR_MISSING_FIELD_WARNING.counterparty_name!);
  if (!counterparty.email) warnings.push(OCR_MISSING_FIELD_WARNING.counterparty_email!);
  // DIČ deliberately isn't checked the same way: plenty of legitimate
  // counterparties (non-VAT-payers, individuals) have none at all, so a
  // missing DIČ isn't itself evidence of a recognition failure the way a
  // missing IČO almost always is.
  if (!counterparty.ico) warnings.push(OCR_MISSING_FIELD_WARNING.counterparty_ico!);
  if (!amount) warnings.push(OCR_MISSING_FIELD_WARNING.amount!);
  if (!issueDate) warnings.push(OCR_MISSING_FIELD_WARNING.issue_date!);
  if (!dueDate) warnings.push(OCR_MISSING_FIELD_WARNING.due_date!);

  const required = [invoiceNumber, counterparty.name, counterparty.ico, counterparty.email, amount > 0, issueDate, dueDate];
  const fieldConfidence = required.filter(Boolean).length / required.length;
  const confidence = Math.max(0, Math.min(1, roundMoney(ocrConfidence === null ? fieldConfidence : fieldConfidence * 0.75 + ocrConfidence / 100 * 0.25)));
  const grossSource = bestSource(documentLayout, amount,{ kind: "amount", labels: /k\s+uhrad[ae]|celkem\s+s\s+dph|k\s+platb[ae]|k\s+proplaceni|grand\s+total|total\s+due|total\s+amount|amount\s+due|balance\s+due/ });
  const netSource = bestSource(documentLayout, amountWithoutVat, { kind: "amount", labels: /bez\s+dph|zaklad|subtotal|soucet\s+polozek|tax\s+base|net\s+amount/ });
  const vatSource = bestSource(documentLayout, vatRate, { kind: "amount", labels: /dph|vat/ });
  const fieldSources: Partial<Record<OcrFieldName, OcrFieldSource>> = {
    invoice_number: bestSource(documentLayout, invoiceNumber, { labels: /cislo\s+(?:faktury|dokladu)|invoice\s*(?:no|number)|faktura|danovy\s+doklad/ }) ?? undefined,
    variable_symbol: bestSource(documentLayout, variableSymbol, { kind: "digits", labels: /variabilni\s+symbol|var\.?\s*symbol|^vs\b/ }) ?? undefined,
    issue_date: bestSource(documentLayout, issueDate, { kind: "date", labels: /datum\s+vystaveni|vystaven[oa]|issue\s*date|invoice\s+date/ }) ?? undefined,
    due_date: bestSource(documentLayout, dueDate, { kind: "date", labels: /splatnost|due\s*date|maturity\s+date/ }) ?? undefined,
    counterparty_name: bestSource(documentLayout, counterparty.name, { labels: COUNTERPARTY_HEADING }) ?? undefined,
    counterparty_ico: bestSource(documentLayout, counterparty.ico, { kind: "digits", labels: /ico|i[0o]{2}|id/ }) ?? undefined,
    counterparty_dic: bestSource(documentLayout, counterparty.dic, { labels: /dic|vat/ }) ?? undefined,
    counterparty_email: bestSource(documentLayout, counterparty.email) ?? undefined,
    amount_without_vat: netSource ?? (grossSource ? { ...grossSource, method: "derived" } : undefined),
    vat_rate: vatSource ?? (grossSource ? { ...grossSource, method: "derived" } : undefined),
    amount: grossSource ?? (netSource ? { ...netSource, method: "derived" } : undefined),
    currency: grossSource ?? netSource ?? undefined,
  };

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
      money_evidence: {
        original_total: roundMoney(Math.max(0, amount)),
        total_source: gross ? "read" : "derived",
        adjustment: roundMoney(amount - grossFromNet(amountWithoutVat, vatRate)),
        adjustment_reason: "",
        adjustment_confirmed: false,
        initial_paid: documentTotal && dueAmount && documentTotal.value >= dueAmount.value ? roundMoney(documentTotal.value - dueAmount.value) : 0,
        initial_paid_confirmed: false,
        multi_rate: distinctVatRates.length > 1,
        source: fieldSources.amount ? JSON.parse(JSON.stringify(fieldSources.amount)) : null,
      },
      currency,
      issue_date: issueDate,
      due_date: dueDate,
      notes: "",
      source: "ocr",
      file_url: fileUrl,
    },
    field_sources: fieldSources,
    confidence,
    warnings: [...new Set(warnings.map(warning => boundedText(warning, 240)).filter(Boolean))].slice(0, 12),
    document_kind: kind,
    issuer_matches_organization: issuerMatch,
    model: LOCAL_OCR_MODEL,
    response_id: null,
  };
}
