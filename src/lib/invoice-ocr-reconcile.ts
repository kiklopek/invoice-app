import "server-only";

import { digits, normalizeComparable, type InvoiceOcrResult, type OcrFieldName, type OcrFieldSource } from "@/lib/invoice-ocr";
import { AMOUNT_ADJUSTMENT_TOLERANCE } from "@/lib/vat";
import type { InvoiceInput } from "@/types/invoice";

// Fields where a silent pick between two disagreeing engines could cost the
// organization real money or misfile a payment against the wrong company.
// For these, disagreement NEVER auto-resolves to one side -- the field keeps
// its local (line/bounds-grounded) value but at low confidence, plus an
// explicit warning naming both readings, so a human decides. This is the
// same posture invoice-ocr.ts and invoice-ocr-gemini.ts already take
// individually; reconcileExtractions just applies it when combining them.
const PROTECTED_FIELDS = new Set<OcrFieldName>(["amount", "amount_without_vat", "vat_rate", "counterparty_ico", "counterparty_dic"]);

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

  const fields = Object.keys(FIELD_LABELS) as OcrFieldName[];
  for (const field of fields) {
    const localValue = fieldValue(local.invoice, field);
    const aiValue = fieldValue(ai.invoice, field);
    const localPresent = isPresent(localValue);
    const aiPresent = isPresent(aiValue);

    if (localPresent && aiPresent) {
      if (valuesAgree(field, localValue, aiValue)) {
        anyAgreement = true;
        const existing = fieldSources[field];
        if (existing) fieldSources[field] = { ...existing, confidence: Math.min(1, (existing.confidence ?? 0.7) + 0.15) };
        continue;
      }
      // Disagreement. Money/identity fields: never silently pick a winner --
      // keep the local, line-grounded value as-is but flag it for review.
      if (PROTECTED_FIELDS.has(field)) {
        moneyDisagreement = true;
        const existing = fieldSources[field];
        if (existing) fieldSources[field] = { ...existing, confidence: Math.min(existing.confidence ?? 0.3, 0.3) };
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
      if (ai.field_sources[field]) fieldSources[field] = ai.field_sources[field];
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

  return {
    invoice,
    field_sources: fieldSources,
    confidence,
    warnings,
    document_kind: local.document_kind,
    issuer_matches_organization: local.issuer_matches_organization,
    reminder_policy_assignment: local.reminder_policy_assignment,
    model: `local+${ai.model}`,
    response_id: ai.response_id,
  };
}
