import "server-only";

import {
  candidateBoundsFromSource,
  digits,
  findLocalGeometry,
  isValidCzSkIco,
  normalizeComparable,
  type InvoiceOcrOrganization,
  type InvoiceOcrResult,
  type OcrDocumentKind,
  type OcrFieldCandidate,
  type OcrFieldDecision,
  type OcrFieldName,
  type OcrFieldSource,
} from "@/lib/invoice-ocr";
import { reconcileExtractions } from "@/lib/invoice-ocr-reconcile";
import { companyNamesAgree, rejectOrganizationIdentity } from "@/lib/invoice-ocr-registry";
import { AMOUNT_ADJUSTMENT_TOLERANCE, grossFromNet, roundMoney, vatAmountsMatch } from "@/lib/vat";
import { isIssuerReminderAddress } from "@/lib/reminder-recipient-safety";

// Vícezdrojové vytěžení faktury.
//
// Téměř bezchybného výsledku nedosáhne žádná jednotlivá čtečka. Dosáhne se
// ho tím, že každé pole buď pochází z PŘESNÉHO zdroje, nebo ho potvrdí druhý
// NEZÁVISLÝ zdroj. Pořadí zdrojů (vyšší vyhrává jen tehdy, když mu nic
// neodporuje):
//
//   1. ISDOC vložený v PDF -- strojově čitelná faktura, přesná.
//   2. QR platba (SPAYD) -- částka, VS, měna, splatnost, přesné.
//   3. ARES podle IČO -- název a DIČ odběratele (řeší invoice-ocr-registry).
//   4. AI (Gemini) -- hlavní čtenář všeho ostatního.
//   5. Lokální parser textu -- nezávislá kontrola a záloha.
//
// Rozpor dvou zdrojů NIKDY nerozhoduje automatika: pole zůstane prázdné, stav
// "k ověření" a obě hodnoty jsou nabídnuté ke zvolení jedním klikem.

export type ExactSourceMethod = "isdoc" | "qr";

export type ExactSourceReading = {
  method: ExactSourceMethod;
  // Krátký popis zdroje pro člověka ("ISDOC příloha faktura.isdoc", "QR platba").
  label: string;
  values: Partial<Record<OcrFieldName, string | number>>;
  // Doslovný kus zdroje, ze kterého hodnota pochází ("AM:3370.00").
  evidence?: Partial<Record<OcrFieldName, string>>;
  document_kind?: OcrDocumentKind;
  // Částka k úhradě po odečtení záloh, pokud ji zdroj zná odděleně od celku.
  payable_amount?: number;
  warnings?: string[];
};

const SOURCE_LABELS: Record<OcrFieldSource["method"], string> = {
  isdoc: "ISDOC",
  qr: "QR platba",
  ares: "ARES",
  customer: "Uložený klient",
  ai: "AI",
  pdf_text: "text PDF",
  ocr: "OCR",
  derived: "dopočet",
};

const FIELD_LABELS: Record<OcrFieldName, string> = {
  invoice_number: "číslo faktury",
  variable_symbol: "variabilní symbol",
  issue_date: "datum vystavení",
  due_date: "datum splatnosti",
  counterparty_name: "jméno odběratele",
  counterparty_ico: "IČO odběratele",
  counterparty_dic: "DIČ odběratele",
  counterparty_email: "e-mail odběratele",
  amount_without_vat: "základ daně",
  vat_rate: "sazbu DPH",
  amount: "celkovou částku",
  currency: "měnu",
};

const NUMERIC_FIELDS = new Set<OcrFieldName>(["amount", "amount_without_vat", "vat_rate"]);

function readField(result: InvoiceOcrResult, field: OcrFieldName): string | number {
  const value = (result.invoice as unknown as Record<OcrFieldName, string | number | undefined>)[field];
  return value ?? (NUMERIC_FIELDS.has(field) ? 0 : "");
}

function writeField(result: InvoiceOcrResult, field: OcrFieldName, value: string | number) {
  (result.invoice as unknown as Record<OcrFieldName, string | number>)[field] = value;
}

function present(field: OcrFieldName, value: string | number | undefined) {
  if (value === undefined || value === null) return false;
  if (typeof value === "number") return field === "vat_rate" ? Number.isFinite(value) : value !== 0;
  return value.trim() !== "";
}

export function ocrValuesAgree(field: OcrFieldName, left: string | number, right: string | number) {
  if (NUMERIC_FIELDS.has(field)) {
    const a = Number(left);
    const b = Number(right);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= AMOUNT_ADJUSTMENT_TOLERANCE;
  }
  const a = String(left).trim();
  const b = String(right).trim();
  switch (field) {
    case "counterparty_ico":
      return digits(a) === digits(b);
    // V bankovním styku se úvodní nuly VS nepočítají ("0012" = "12").
    case "variable_symbol":
      return digits(a).replace(/^0+/, "") === digits(b).replace(/^0+/, "") && /^\d+$/.test(a) === /^\d+$/.test(b);
    case "counterparty_dic":
      return a.replace(/[\s-]/g, "").toUpperCase() === b.replace(/[\s-]/g, "").toUpperCase();
    case "counterparty_name":
      return normalizeComparable(a) === normalizeComparable(b) || companyNamesAgree(a, b);
    case "counterparty_email":
      return a.toLowerCase() === b.toLowerCase();
    case "currency":
      return a.toUpperCase() === b.toUpperCase();
    default:
      return normalizeComparable(a) === normalizeComparable(b);
  }
}

// `source` must be the source OF `value` (its box then points at this value).
function candidateFrom(field: OcrFieldName, value: string | number, source: Partial<OcrFieldSource> & { method: OcrFieldSource["method"] }): OcrFieldCandidate {
  const page = source.page ?? 1;
  const text = source.text ?? String(value);
  return {
    value,
    page,
    text,
    method: source.method,
    confidence: source.confidence ?? null,
    role: source.role ?? (field.startsWith("counterparty_") ? "counterparty" : "document"),
    ...candidateBoundsFromSource({ page, text, method: source.method, bounds: source.bounds ?? null }),
  };
}

function uniqueCandidates(candidates: OcrFieldCandidate[], field: OcrFieldName) {
  const result: OcrFieldCandidate[] = [];
  for (const candidate of candidates) {
    const same = result.find(existing => existing.method === candidate.method && ocrValuesAgree(field, existing.value, candidate.value));
    if (!same) result.push(candidate);
  }
  return result;
}

function cloneResult(result: InvoiceOcrResult): InvoiceOcrResult {
  return {
    ...result,
    invoice: { ...result.invoice, ...(result.invoice.money_evidence ? { money_evidence: { ...result.invoice.money_evidence } } : {}) },
    field_sources: { ...result.field_sources },
    field_decisions: { ...result.field_decisions },
    warnings: [...result.warnings],
  };
}

// Přesný zdroj přepisuje nižší zdroje jen tam, kde mu nikdo neodporuje. Při
// rozporu (ISDOC vs QR, ISDOC vs čtení dokumentu, QR vs čtení dokumentu) se
// pole vyprázdní a všechny hodnoty zůstanou jako kandidáti k volbě.
export function applyExactSources(base: InvoiceOcrResult, readings: ExactSourceReading[]): InvoiceOcrResult {
  const ordered = [...readings].sort((left, right) => (left.method === right.method ? 0 : left.method === "isdoc" ? -1 : 1));
  if (!ordered.length) return base;
  const result = cloneResult(base);
  const initialPaid = base.invoice.money_evidence?.initial_paid ?? 0;

  for (const reading of ordered) {
    for (const warning of reading.warnings ?? []) if (!result.warnings.includes(warning)) result.warnings.push(warning);
  }

  const fields = Object.keys(FIELD_LABELS) as OcrFieldName[];
  for (const field of fields) {
    const exact = ordered
      .filter(reading => present(field, reading.values[field]))
      .map(reading => ({ reading, value: reading.values[field] as string | number }));
    if (!exact.length) continue;

    const primary = exact[0];
    const baseValue = readField(base, field);
    const basePresent = present(field, baseValue) && !(field === "vat_rate" && !base.field_sources.vat_rate && baseValue === 0);
    const baseDecision = base.field_decisions[field];

    // QR platba nese částku K ÚHRADĚ. Když dokument odečítá zaplacené zálohy,
    // je menší než celková hodnota faktury -- to je shoda, ne rozpor.
    const agreesWithBase = (reading: ExactSourceReading, value: string | number) => {
      if (ocrValuesAgree(field, baseValue, value)) return true;
      if (field === "amount" && reading.method === "qr" && initialPaid > 0) {
        return ocrValuesAgree(field, roundMoney(Number(baseValue) - initialPaid), value);
      }
      return false;
    };
    const exactConflict = exact.some(entry => !ocrValuesAgree(field, entry.value, primary.value)
      && !(field === "amount" && entry.reading.method === "qr" && primary.reading.payable_amount !== undefined
        && ocrValuesAgree(field, entry.value, primary.reading.payable_amount)));
    const baseConflict = basePresent && exact.some(entry => !agreesWithBase(entry.reading, entry.value));
    // Pole, které už předtím skončilo rozporem (lokální vs AI), se přesným
    // zdrojem nevyřeší, pokud některý z kandidátů přesnému zdroji odporuje.
    const priorConflict = !basePresent && baseDecision?.status === "review"
      && baseDecision.candidates.some(candidate => !ocrValuesAgree(field, candidate.value, primary.value));

    // Where the document itself shows a value: the local reading of exactly
    // that value (the field's source, or a candidate the parser offered).
    const localGeometry = (value: string | number) => findLocalGeometry(field, value, {
      source: basePresent ? base.field_sources[field] : undefined,
      sourceValue: basePresent ? baseValue : undefined,
      candidates: baseDecision?.candidates ?? [],
    });
    const exactCandidates = exact.map(entry => {
      const geometry = localGeometry(entry.value);
      return {
        ...candidateFrom(field, entry.value, {
          method: entry.reading.method,
          text: entry.reading.evidence?.[field] ?? `${entry.reading.label}: ${entry.value}`,
          confidence: 0.99,
        }),
        // Evidence text stays the exact source's; page + box are the document's.
        ...(geometry ? { page: geometry.page, bounds: geometry.bounds } : {}),
      };
    });

    if (exactConflict || baseConflict || priorConflict) {
      const baseCandidates = basePresent
        ? [candidateFrom(field, baseValue, base.field_sources[field] ?? { method: "ocr" })]
        : baseDecision?.candidates ?? [];
      writeField(result, field, NUMERIC_FIELDS.has(field) ? 0 : "");
      delete result.field_sources[field];
      const described = [...exactCandidates, ...baseCandidates]
        .map(candidate => `${SOURCE_LABELS[candidate.method]}: ${candidate.value}`).join(", ");
      result.field_decisions[field] = {
        status: "review",
        confidence: 0,
        reasons: [`Zdroje se neshodují na poli ${FIELD_LABELS[field]} (${described}). Pole zůstalo prázdné – vyberte správnou hodnotu podle dokumentu.`],
        candidates: uniqueCandidates([...exactCandidates, ...baseCandidates], field),
      };
      const warning = `Zdroje se neshodují na poli ${FIELD_LABELS[field]} (${described}) – zkontrolujte ručně.`;
      if (!result.warnings.includes(warning)) result.warnings.push(warning);
      continue;
    }

    // QR nese částku K ÚHRADĚ: když souhlasí jen se zbytkem po zálohách, pole
    // "celková hodnota" si ponechá přečtený celek -- QR ho jen potvrzuje.
    const confirmsRemainderOnly = field === "amount" && primary.reading.method === "qr" && basePresent
      && !ocrValuesAgree(field, baseValue, primary.value);
    const value = confirmsRemainderOnly ? baseValue : field === "currency" ? String(primary.value).toUpperCase() : primary.value;
    writeField(result, field, value);
    // The method stays the exact source (that is where the value comes from);
    // the document line that shows the SAME value only lends its position.
    const geometry = localGeometry(value);
    const source: OcrFieldSource = {
      page: geometry?.page ?? 1,
      line: geometry?.line ?? 0,
      text: (geometry?.text ?? exactCandidates[0].text).slice(0, 240),
      method: primary.reading.method,
      confidence: 0.99,
      bounds: geometry?.bounds ?? null,
      role: field.startsWith("counterparty_") ? "counterparty" : "document",
    };
    result.field_sources[field] = source;
    const confirmedBy = [
      ...exact.slice(1).map(entry => SOURCE_LABELS[entry.reading.method]),
      ...(basePresent && base.field_sources[field] ? [SOURCE_LABELS[base.field_sources[field]!.method]] : []),
    ];
    result.field_decisions[field] = {
      status: "verified",
      confidence: 0.99,
      reasons: [`Hodnota pochází z přesného zdroje (${primary.reading.label})${confirmedBy.length ? ` a shoduje se s: ${[...new Set(confirmedBy)].join(", ")}` : ""}.`],
      candidates: [exactCandidates[0]],
    };
  }

  // Druh dokladu z ISDOC je přesný údaj. Když se liší od čtení dokumentu,
  // platí ISDOC, ale rozdíl se ukáže.
  const kindFromExact = ordered.find(reading => reading.document_kind)?.document_kind;
  if (kindFromExact) {
    if (kindFromExact !== result.document_kind) {
      result.warnings.push(`Druh dokladu podle ISDOC se liší od čtení dokumentu. Použit je údaj z ISDOC – ověřte typ dokladu.`);
    }
    result.document_kind = kindFromExact;
    result.document_kind_reported = true;
  }

  // Zálohy odečtené v ISDOC (celkem > k úhradě) se předvyplní jako počáteční
  // úhrada -- formulář je bez výslovného potvrzení neuloží.
  const isdoc = ordered.find(reading => reading.method === "isdoc");
  if (isdoc?.payable_amount !== undefined && result.invoice.amount > 0 && result.invoice.money_evidence) {
    const paid = roundMoney(result.invoice.amount - isdoc.payable_amount);
    if (paid > AMOUNT_ADJUSTMENT_TOLERANCE) {
      result.invoice.money_evidence = { ...result.invoice.money_evidence, initial_paid: paid, initial_paid_confirmed: false };
    }
  }
  if (result.invoice.money_evidence && result.invoice.amount !== base.invoice.amount) {
    result.invoice.money_evidence = {
      ...result.invoice.money_evidence,
      original_total: result.invoice.amount,
      total_source: result.invoice.amount ? "read" : "derived",
      adjustment: roundMoney(result.invoice.amount - grossFromNet(result.invoice.amount_without_vat, result.invoice.vat_rate)),
      source: result.field_sources.amount ? JSON.parse(JSON.stringify(result.field_sources.amount)) : null,
    };
  }
  return result;
}

function downgrade(decision: OcrFieldDecision | undefined, reason: string, keepValue: boolean): OcrFieldDecision {
  const base = decision ?? { status: "review" as const, confidence: 0, reasons: [], candidates: [] };
  return {
    ...base,
    status: base.status === "missing" ? "missing" : "review",
    confidence: Math.min(base.confidence, 0.49),
    reasons: [...new Set([...base.reasons, reason])],
    needs_confirmation: keepValue ? true : undefined,
  };
}

function withhold(result: InvoiceOcrResult, field: OcrFieldName, reason: string) {
  const value = readField(result, field);
  const source = result.field_sources[field];
  const decision = downgrade(result.field_decisions[field], reason, false);
  decision.status = "review";
  if (present(field, value) && !decision.candidates.some(candidate => ocrValuesAgree(field, candidate.value, value))) {
    decision.candidates = [...decision.candidates, candidateFrom(field, value, source ?? { method: "ocr" })];
  }
  result.field_decisions[field] = decision;
  writeField(result, field, NUMERIC_FIELDS.has(field) ? 0 : "");
  delete result.field_sources[field];
}

// Kontroly nad výsledkem, nezávislé na tom, z jakého zdroje hodnota přišla.
// Selhání nikdy nic tiše neopraví: pole jde "k ověření" s českým vysvětlením.
export function applyOcrConsistencyChecks(input: InvoiceOcrResult, organization: InvoiceOcrOrganization): InvoiceOcrResult {
  const result = cloneResult(input);
  const invoice = result.invoice;

  if (isIssuerReminderAddress(invoice.counterparty_email, organization)) {
    const reason = "E-mail patří vystaviteli faktury; pro upomínky zadejte kontakt odběratele z jiné domény.";
    withhold(result, "counterparty_email", reason);
    result.warnings.push(reason);
    const decision = result.field_decisions.counterparty_email;
    if (decision) decision.candidates = decision.candidates.map(candidate => ({ ...candidate, role: "issuer" }));
  }

  // Základ + DPH = celkem. Hodnoty zůstanou (formulář sám vynutí vysvětlení
  // a potvrzení rozdílu), ale nesmí se tvářit jako ověřené.
  if (invoice.amount > 0 && invoice.amount_without_vat > 0 && !invoice.money_evidence?.multi_rate
    && !vatAmountsMatch(invoice.amount_without_vat, invoice.vat_rate, invoice.amount)) {
    const reason = `Základ ${invoice.amount_without_vat} + DPH ${invoice.vat_rate} % nedává celkovou částku ${invoice.amount}. Zkontrolujte všechny tři hodnoty.`;
    for (const field of ["amount", "amount_without_vat", "vat_rate"] as const) {
      result.field_decisions[field] = downgrade(result.field_decisions[field], reason, true);
    }
  }

  // Splatnost nesmí předcházet vystavení.
  if (invoice.issue_date && invoice.due_date && invoice.due_date < invoice.issue_date) {
    withhold(result, "due_date", `Datum splatnosti ${invoice.due_date} je dřívější než datum vystavení ${invoice.issue_date}.`);
  }

  // VS: jen číslice, nejvýše 10 znaků (banka jiný nepřenese).
  if (invoice.variable_symbol && !/^\d{1,10}$/.test(invoice.variable_symbol.trim())) {
    withhold(result, "variable_symbol", `Variabilní symbol „${invoice.variable_symbol}“ nemá tvar až 10 číslic.`);
  }

  // IČO: 8 číslic a kontrolní číslice.
  const ico = invoice.counterparty_ico?.trim() ?? "";
  if (ico && !isValidCzSkIco(ico)) {
    withhold(result, "counterparty_ico", `IČO ${ico} nemá 8 číslic nebo neprošlo kontrolním součtem.`);
  }

  // DIČ právnické osoby = CZ + IČO. (DIČ fyzické osoby je CZ + rodné číslo,
  // 9–10 číslic, a s IČO se neshoduje -- ten případ se nekontroluje.)
  const dic = invoice.counterparty_dic?.replace(/[\s-]/g, "").toUpperCase() ?? "";
  const currentIco = digits(result.invoice.counterparty_ico);
  if (dic && /^CZ\d{8}$/.test(dic) && currentIco && digits(dic) !== currentIco) {
    withhold(result, "counterparty_dic", `DIČ ${dic} neodpovídá IČO ${currentIco} (u firmy je DIČ = CZ + IČO).`);
  }

  // Vystavitel = organizace z Nastavení. Nemění pole (firma může fakturovat
  // i pod jinou identitou), ale rozpor musí být vidět.
  const ownIco = digits(organization.ico);
  if (ownIco && digits(result.invoice.counterparty_ico) === ownIco) {
    withhold(result, "counterparty_ico", `IČO ${ownIco} patří vaší firmě (vystaviteli), nikoli odběrateli.`);
  }
  return result;
}

// Sloučí všechny dostupné zdroje do jednoho výsledku. ARES (síťový dotaz) se
// volá zvlášť po sloučení -- viz validateCounterpartyWithAres.
export function mergeOcrSources({ local, ai, exact = [], organization }: {
  local?: InvoiceOcrResult | null;
  ai?: InvoiceOcrResult | null;
  exact?: ExactSourceReading[];
  organization: InvoiceOcrOrganization;
}): InvoiceOcrResult {
  const base = local && ai ? reconcileExtractions(local, ai) : local ?? ai;
  if (!base) throw new Error("mergeOcrSources: chybí lokální i AI výsledek.");
  const withExact = applyExactSources(base, exact);
  const guarded = rejectOrganizationIdentity(withExact, organization);
  return applyOcrConsistencyChecks(guarded, organization);
}
