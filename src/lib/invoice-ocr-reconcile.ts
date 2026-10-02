import "server-only";

import { candidateBoundsFromSource, deriveOcrFieldDecisions, digits, findLocalGeometry, normalizeComparable, OCR_MISSING_FIELD_WARNING, type InvoiceOcrResult, type OcrFieldCandidate, type OcrFieldDecision, type OcrFieldName, type OcrFieldSource } from "@/lib/invoice-ocr";
import { AMOUNT_ADJUSTMENT_TOLERANCE } from "@/lib/vat";
import { ASSUMED_CZK_REASON } from "@/lib/invoice-currency";
import type { InvoiceInput } from "@/types/invoice";

// Fields where a silent pick between two disagreeing engines could cost the
// organization real money or misfile a payment against the wrong company.
// For these, disagreement NEVER auto-resolves to one side -- the field stays
// empty while both readings remain available as evidence for review. This is the
// same posture invoice-ocr.ts and invoice-ocr-gemini.ts already take
// individually; reconcileExtractions just applies it when combining them.
const PROTECTED_FIELDS = new Set<OcrFieldName>([
  "invoice_number", "variable_symbol", "issue_date", "due_date",
  "counterparty_name", "counterparty_ico", "counterparty_dic",
  "amount", "amount_without_vat", "vat_rate", "currency",
]);

export const DEFAULT_HYBRID_CONFIDENCE_THRESHOLD = 0.8;

// Never silently degrades: a misconfigured threshold (non-numeric, or
// outside [0,1] -- e.g. "80" typed instead of "0.8") falls back to the
// documented default and says so loudly, instead of either disabling the AI
// cross-check forever (a NaN comparison is always false, so it never fires)
// or calling AI on every single document (threshold > 1 makes the
// confidence comparison always true -- a direct cost-multiplication bug).
export function parseConfidenceThreshold(raw: string | undefined, fallback: number = DEFAULT_HYBRID_CONFIDENCE_THRESHOLD): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    console.warn(`[invoice-ocr-reconcile] OCR_HYBRID_CONFIDENCE_THRESHOLD="${raw}" je mimo platný rozsah [0,1] nebo není číslo -- použije se výchozí hodnota ${fallback}.`);
    return fallback;
  }
  return parsed;
}

const NUMERIC_FIELDS = new Set<OcrFieldName>(["amount", "amount_without_vat", "vat_rate"]);

function fieldValue(invoice: InvoiceInput, field: OcrFieldName): string | number {
  const value = (invoice as unknown as Record<OcrFieldName, string | number | undefined>)[field];
  return value ?? (NUMERIC_FIELDS.has(field) ? 0 : "");
}

function isPresent(value: string | number): boolean {
  return typeof value === "number" ? value !== 0 : value.trim() !== "";
}

function valuesAgree(field: OcrFieldName, a: string | number, b: string | number): boolean {
  if (typeof a === "number" || typeof b === "number") {
    const numA = typeof a === "number" ? a : Number(a);
    const numB = typeof b === "number" ? b : Number(b);
    if (!Number.isFinite(numA) || !Number.isFinite(numB)) return false;
    return Math.abs(numA - numB) <= AMOUNT_ADJUSTMENT_TOLERANCE;
  }
  if (field === "counterparty_ico") return digits(a) === digits(b);
  return normalizeComparable(a) === normalizeComparable(b);
}

function formatForWarning(field: OcrFieldName, value: string | number): string {
  if (field === "vat_rate" && typeof value === "number") return `${value} %`;
  return String(value);
}

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

const AI_MISSING_FIELD_WARNING = {
  counterparty_name: "AI nerozpoznala jméno odběratele.",
  counterparty_ico: "AI nerozpoznala IČO odběratele.",
  amount: "AI nerozpoznala celkovou částku faktury.",
} as const;

const NON_INVOICE_WARNING = "Dokument nemusí být běžná vydaná faktura. Před uložením ověřte jeho typ.";

const KIND_LABELS: Record<InvoiceOcrResult["document_kind"], string> = {
  issued_invoice: "faktura",
  proforma: "zálohová faktura",
  credit_note: "dobropis",
  other: "jiný dokument",
};

// Merges a local (pdfjs/Tesseract + regex) extraction with an AI (Gemini)
// extraction of the SAME document, field by field, never wholesale
// preferring one engine. See PROTECTED_FIELDS above for the one hard rule: a
// disagreement there always surfaces to the human reviewer instead of
// silently resolving. Everything else in this function is additive to the
// existing field_sources/confidence/warnings contract -- the review UI
// (invoice-form.tsx) needs no changes to render its result.
export function reconcileExtractions(local: InvoiceOcrResult, ai: InvoiceOcrResult): InvoiceOcrResult {
  const invoice: InvoiceInput = { ...local.invoice };
  const fieldSources: Partial<Record<OcrFieldName, OcrFieldSource>> = { ...local.field_sources };
  const warnings = [...local.warnings];
  let moneyDisagreement = false;
  let anyAgreement = false;
  const conflictingCandidates: Partial<Record<OcrFieldName, OcrFieldCandidate[]>> = {};
  const outcome: Partial<Record<OcrFieldName, "agreed" | "ai_only" | "disagreed">> = {};

  const fields = Object.keys(FIELD_LABELS) as OcrFieldName[];
  for (const field of fields) {
    const localValue = fieldValue(local.invoice, field);
    const aiValue = fieldValue(ai.invoice, field);
    // A default CZK without a document source is an assumption, not a
    // competing reading. A documented AI currency may fill it for review.
    const localCurrencyAssumed = field === "currency" && localValue === "CZK"
      && !local.field_sources.currency
      && local.field_decisions.currency?.reasons.includes(ASSUMED_CZK_REASON);
    const localPresent = isPresent(localValue) && !localCurrencyAssumed;
    const aiPresent = isPresent(aiValue);

    if (localPresent && aiPresent) {
      if (valuesAgree(field, localValue, aiValue)) {
        anyAgreement = true;
        outcome[field] = "agreed";
        const existing = fieldSources[field];
        if (existing) fieldSources[field] = { ...existing, confidence: Math.min(1, (existing.confidence ?? 0.7) + 0.15) };
        continue;
      }
      outcome[field] = "disagreed";
      // Disagreement on a critical field: neither engine wins. Keep both
      // readings as auditable candidates, but leave the form field empty.
      if (PROTECTED_FIELDS.has(field)) {
        moneyDisagreement = true;
        const candidate = (value: string | number, source: OcrFieldSource | undefined): OcrFieldCandidate => ({
          value,
          page: source?.page ?? 1,
          text: source?.text ?? String(value),
          method: source?.method ?? "ai",
          confidence: source?.confidence ?? null,
          role: source?.role ?? (field.startsWith("counterparty_") ? "counterparty" : "document"),
          // `source` is the reading of this very value, so its box is too.
          ...(source ? candidateBoundsFromSource(source) : {}),
        });
        conflictingCandidates[field] = [candidate(localValue, local.field_sources[field]), candidate(aiValue, ai.field_sources[field])];
        (invoice as unknown as Record<OcrFieldName, string | number>)[field] = NUMERIC_FIELDS.has(field) ? 0 : "";
        delete fieldSources[field];
        warnings.push(
          `Lokální rozpoznávač a AI se neshodují na poli ${FIELD_LABELS[field]} ` +
            `(${formatForWarning(field, localValue)} vs ${formatForWarning(field, aiValue)}) -- zkontrolujte ručně.`,
        );
      } else {
        // Non-money field: safe to prefer whichever source reports higher
        // per-field confidence (both may be null, in which case local stays
        // -- it's already grounded in a specific document line/bounds).
        const localConfidence = fieldSources[field]?.confidence ?? null;
        const aiConfidence = ai.field_sources[field]?.confidence ?? null;
        if (aiConfidence !== null && (localConfidence === null || aiConfidence > localConfidence)) {
          (invoice as unknown as Record<OcrFieldName, string | number>)[field] = aiValue;
          if (ai.field_sources[field]) fieldSources[field] = ai.field_sources[field];
        }
        warnings.push(`Lokální rozpoznávač a AI se neshodují na poli ${FIELD_LABELS[field]} -- zkontrolujte prosím.`);
      }
      continue;
    }

    if (!localPresent && aiPresent) {
      const rejectedDifferentOwner = (field === "counterparty_ico" || field === "counterparty_dic")
        && local.warnings.some(warning => warning.startsWith(field === "counterparty_ico" ? "IČO" : "DIČ") && warning.includes("nebylo přiřazeno"));
      // The local parser saw the value but also saw explicit document
      // evidence that it belongs to another named party. An ungrounded AI
      // answer must not reinsert that same dangerous value into the gap.
      if (rejectedDifferentOwner) continue;
      // AI found something local missed entirely -- fill the gap. Still
      // subject to the money-safety posture: an AI-only money value is
      // exactly as unverified as any other single-source AI read, so it
      // keeps whatever warning the AI extraction itself already raised for
      // that condition (e.g. "AI nerozpoznala..." doesn't apply here since
      // AI DID find it, but no independent corroboration exists either).
      (invoice as unknown as Record<OcrFieldName, string | number>)[field] = aiValue;
      const aiSource = ai.field_sources[field];
      if (aiSource) {
        // The local parser may still have seen exactly this value (e.g. as one
        // of several candidates it would not pick alone). Its position is then
        // where the value sits in the document; the method stays "ai" because
        // the AI is what chose it. A different local value lends nothing.
        const geometry = findLocalGeometry(field, aiValue, {
          source: local.field_sources[field],
          sourceValue: localValue,
          candidates: local.field_decisions[field]?.candidates ?? [],
        });
        fieldSources[field] = geometry
          ? { ...aiSource, page: geometry.page, line: geometry.line, text: geometry.text, bounds: geometry.bounds }
          : aiSource;
      }
      outcome[field] = "ai_only";
    }
    // else: local-only or neither -- keep local's value/absence as-is. Local
    // already produces its own "nebylo rozpoznáno" warnings for genuinely
    // missing fields; no need to duplicate them here.
  }

  // Carry over the AI's own warnings (its GDPR disclosure, self-IČO guard,
  // its own vatAmountsMatch check, etc.) rather than dropping them -- a
  // person reviewing this result still has a right to know the document was
  // sent to Gemini, independent of anything reconciliation found.
  for (const warning of ai.warnings) if (!warnings.includes(warning)) warnings.push(warning);

  // Two independent engines agreeing on a field is real evidence; agreeing
  // is grounds to raise confidence, but a flagged money disagreement must
  // cap it low regardless of how many other fields agreed -- the whole
  // point of the merge is that this document needs a human look before
  // saving.
  let confidence = local.confidence;
  if (moneyDisagreement) confidence = Math.min(confidence, 0.35);
  else if (anyAgreement) confidence = Math.min(1, confidence + 0.1);

  // A "not recognized" warning describes ONE engine's reading. Once the other
  // engine filled the field it is no longer true -- and because field
  // decisions map warnings to fields by wording, leaving it in turned every
  // AI-filled field into "review" and active mode then blanked the value.
  const filled = (field: keyof typeof AI_MISSING_FIELD_WARNING | keyof typeof OCR_MISSING_FIELD_WARNING) => {
    const value = (invoice as unknown as Record<string, string | number | undefined>)[field];
    return typeof value === "number" ? value > 0 : Boolean(value?.trim());
  };
  const staleWarnings = new Set<string>([
    ...(Object.entries(OCR_MISSING_FIELD_WARNING) as Array<[keyof typeof OCR_MISSING_FIELD_WARNING, string]>)
      .filter(([field]) => filled(field)).map(([, warning]) => warning),
    ...(Object.entries(AI_MISSING_FIELD_WARNING) as Array<[keyof typeof AI_MISSING_FIELD_WARNING, string]>)
      .filter(([field]) => filled(field)).map(([, warning]) => warning),
  ]);
  const uniqueWarnings = [...new Set(warnings)].filter(warning => !staleWarnings.has(warning));
  const derived = deriveOcrFieldDecisions(invoice, fieldSources, uniqueWarnings);
  const fieldDecisions: Partial<Record<OcrFieldName, OcrFieldDecision>> = {};
  for (const field of fields) {
    const localDecision = local.field_decisions[field];
    const derivedDecision = derived[field];
    if (!outcome[field]) {
      // Local-only or neither: the AI added nothing, so the local parser's own
      // decision (including its extra reasons and candidate lists) stands.
      fieldDecisions[field] = localDecision ?? derivedDecision;
    } else if (outcome[field] === "ai_only" && derivedDecision?.status === "verified") {
      // One model's reading with nothing contradicting it: keep it in the
      // form, but it is not independently confirmed -- a person confirms it.
      fieldDecisions[field] = {
        ...derivedDecision,
        status: "review",
        confidence: Math.min(derivedDecision.confidence, 0.59),
        reasons: [...derivedDecision.reasons, `Hodnotu pro ${FIELD_LABELS[field]} přečetla jen AI, žádný další zdroj ji nepotvrdil. Potvrďte ji podle dokumentu.`],
        needs_confirmation: true,
      };
    } else if (outcome[field] === "agreed" && localDecision && localDecision.candidates.length > 1) {
      // Local saw several candidates; AI agreeing with the first one does not
      // make the ambiguity go away.
      fieldDecisions[field] = localDecision;
    } else if (outcome[field] === "agreed" && localDecision?.needs_confirmation && derivedDecision?.status === "verified") {
      // Second independent reading confirms a value local could only offer
      // for confirmation (e.g. a name from a damaged PDF text layer).
      fieldDecisions[field] = { ...derivedDecision, reasons: ["Hodnotu potvrdilo lokální čtení i AI."] };
    } else {
      fieldDecisions[field] = derivedDecision;
    }
  }
  for (const [field, candidates] of Object.entries(conflictingCandidates) as Array<[OcrFieldName, OcrFieldCandidate[]]>) {
    fieldDecisions[field] = {
      status: "review",
      confidence: 0,
      reasons: [`Lokální OCR a AI nabídly pro ${FIELD_LABELS[field]} rozdílné hodnoty. Pole zůstalo prázdné.`],
      candidates,
    };
  }
  // Document kind: the AI's answer counts only when it actually classified
  // the document (document_kind_reported). A disagreement is never resolved
  // silently -- the non-invoice reading wins (safer: it withholds treating
  // an advance invoice as a receivable) and the conflict is shown.
  let documentKind = local.document_kind;
  let kindWarning: string | null = null;
  if (ai.document_kind_reported && ai.document_kind !== local.document_kind) {
    documentKind = ai.document_kind === "issued_invoice" ? local.document_kind : ai.document_kind;
    kindWarning = `Druh dokladu se liší: lokální rozpoznání „${KIND_LABELS[local.document_kind]}“, AI „${KIND_LABELS[ai.document_kind]}“. Ověřte typ dokladu.`;
  }
  if (documentKind !== "issued_invoice" && !uniqueWarnings.includes(NON_INVOICE_WARNING)) uniqueWarnings.unshift(NON_INVOICE_WARNING);
  return {
    invoice,
    field_sources: fieldSources,
    field_decisions: fieldDecisions,
    confidence,
    warnings: kindWarning ? [...uniqueWarnings, kindWarning] : uniqueWarnings,
    document_kind: documentKind,
    document_kind_reported: true,
    issuer_matches_organization: local.issuer_matches_organization,
    reminder_policy_assignment: local.reminder_policy_assignment,
    model: `local+${ai.model}`,
    response_id: ai.response_id,
    vocabulary_version: local.vocabulary_version,
    keyword_suggestions: local.keyword_suggestions,
  };
}
