import type { OcrFieldDecision, OcrFieldName, OcrFieldSource } from "./invoice-ocr";

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

// Pole s hodnotou jen z jednoho zdroje (needs_confirmation), která ve
// formuláři pořád drží předvyplněnou hodnotu a člověk ji ještě nepotvrdil.
export function pendingOcrConfirmations(
  decisions: Partial<Record<OcrFieldName, OcrFieldDecision>> | undefined,
  initial: Partial<Record<OcrFieldName, unknown>> | undefined,
  form: Partial<Record<OcrFieldName, unknown>>,
  confirmed: ReadonlySet<OcrFieldName>,
): OcrFieldName[] {
  if (!decisions) return [];
  return (Object.entries(decisions) as Array<[OcrFieldName, OcrFieldDecision | undefined]>)
    .filter(([field, decision]) => decision?.status === "review" && decision.needs_confirmation
      && !confirmed.has(field) && filled(form[field]) && sameValue(form[field], initial?.[field]))
    .map(([field]) => field);
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
  return choices;
}
