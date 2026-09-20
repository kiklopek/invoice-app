import { money, minorUnits, multiplyRatio } from "./money";
export const DEFAULT_VAT_RATE = 21;
export const MAX_VAT_RATE = 100;

export function roundMoney(value: number) {
  return money(value);
}

export function grossFromNet(netAmount: number, vatRate: number) {
  if (!Number.isFinite(netAmount) || !Number.isFinite(vatRate)) return 0;
  return multiplyRatio(netAmount, 10000 + minorUnits(vatRate), 10000);
}

export function netFromGross(grossAmount: number, vatRate: number) {
  if (!Number.isFinite(grossAmount) || !Number.isFinite(vatRate) || vatRate <= -100) return 0;
  return multiplyRatio(grossAmount, 10000, 10000 + minorUnits(vatRate));
}

// OCR candidate-ranking heuristic only. This must never authorize a monetary
// write: validation requires explicit confirmation for every nonzero difference.
const VAT_RECONCILIATION_TOLERANCE = 1;

export function vatAmountsMatch(netAmount: number, vatRate: number, grossAmount: number) {
  return Math.abs(grossFromNet(netAmount, vatRate) - roundMoney(grossAmount)) <= VAT_RECONCILIATION_TOLERANCE;
}

// This one DOES authorize skipping the manual "vysvětlete a potvrďte rozdíl"
// step -- kept deliberately smaller than a real error would ever be. A
// multi-line invoice rounds each line to 2 decimals before summing, so its
// printed total routinely differs from base*rate/100 by a few haléře with no
// mistake anywhere; forcing a person to type a reason and tick a box for
// that is friction with no safety benefit. Anything past this is still
// exactly as strict as before -- every real discrepancy still requires
// explicit confirmation, in the UI (invoice-form.tsx) and in the database
// (validate_invoice_money_evidence, which mirrors this same value).
export const AMOUNT_ADJUSTMENT_TOLERANCE = 0.05;
