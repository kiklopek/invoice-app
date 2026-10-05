import type { OcrFieldDecision, OcrFieldName, OcrFieldSource } from "./invoice-ocr";
import type { InvoiceInput } from "@/types/invoice";

// Pomocné funkce formuláře pro kontrolu vytěžených polí. Oddělené od React
// komponenty, aby šly otestovat bez prohlížeče.

const SOURCE_LABELS: Record<OcrFieldSource["method"], string> = {
  isdoc: "ISDOC",
  qr: "QR platba",
  ares: "ARES",
  customer: "Uložený klient",
  ai: "AI",
  pdf_text: "text",
  ocr: "text (OCR)",
  derived: "dopočet",
};

export function ocrSourceLabel(method: OcrFieldSource["method"]) {
  return SOURCE_LABELS[method] ?? "text";
}

function sameValue(left: unknown, right: unknown) {
  if (typeof left === "number" || typeof right === "number") return Math.abs(Number(left) - Number(right)) < 0.005;
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}

function filled(value: unknown) {
  return typeof value === "number" ? value !== 0 : Boolean(String(value ?? "").trim());
}

// An older draft must not hide newly extracted values on an OCR retry.
// Preserve filled edits, including an explicitly selected zero VAT rate.
export function backfillOcrDraft(
  draft: InvoiceInput,
  initial: InvoiceInput | undefined,
  decisions: Partial<Record<OcrFieldName, OcrFieldDecision>> | undefined,
): InvoiceInput {
  const form = { ...draft };
  if (!initial || !decisions) return form;
  for (const field of Object.keys(decisions) as OcrFieldName[]) {
    if (field === "vat_rate" && typeof form[field] === "number") continue;
    if (!filled(form[field]) && filled(initial[field])) {
      (form as unknown as Record<OcrFieldName, unknown>)[field] = initial[field];
    }
  }
  return form;
}

export type OcrCandidateChoice = { value: string | number; sources: string[] };

// Kandidáti k volbě jedním klikem: stejné hodnoty z více zdrojů se sloučí,
// hodnota, kterou pole už má, se nenabízí.
export function alternativeOcrCandidates(decision: OcrFieldDecision | undefined, current: unknown): OcrCandidateChoice[] {
  if (!decision || decision.status !== "review") return [];
  const choices: OcrCandidateChoice[] = [];
  for (const candidate of decision.candidates) {
    if (candidate.role === "issuer") continue;
    if (!filled(candidate.value) || (filled(current) && sameValue(candidate.value, current))) continue;
    const existing = choices.find(choice => sameValue(choice.value, candidate.value));
    const label = ocrSourceLabel(candidate.method);
    if (existing) {
      if (!existing.sources.includes(label)) existing.sources.push(label);
    } else {
      choices.push({ value: candidate.value, sources: [label] });
    }
  }
  // A single plausible reading is prefilled by the OCR pipeline and marked
  // for confirmation. A rejected lone reading must be typed deliberately.
  return !filled(current) && choices.length === 1 ? [] : choices;
}
