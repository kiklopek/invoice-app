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

// OCR candidate-ranking heuristic; submitted totals are preserved independently.
const VAT_RECONCILIATION_TOLERANCE = 1;

export function vatAmountsMatch(netAmount: number, vatRate: number, grossAmount: number) {
  return Math.abs(grossFromNet(netAmount, vatRate) - roundMoney(grossAmount)) <= VAT_RECONCILIATION_TOLERANCE;
}

// Tolerance for comparing monetary values from OCR sources.
export const AMOUNT_ADJUSTMENT_TOLERANCE = 0.05;
