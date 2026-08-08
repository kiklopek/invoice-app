export const DEFAULT_VAT_RATE = 21;
export const MAX_VAT_RATE = 100;

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function grossFromNet(netAmount: number, vatRate: number) {
  if (!Number.isFinite(netAmount) || !Number.isFinite(vatRate)) return 0;
  return roundMoney(netAmount * (100 + vatRate) / 100);
}

export function netFromGross(grossAmount: number, vatRate: number) {
  if (!Number.isFinite(grossAmount) || !Number.isFinite(vatRate) || vatRate <= -100) return 0;
  return roundMoney(grossAmount * 100 / (100 + vatRate));
}

export function vatAmountsMatch(netAmount: number, vatRate: number, grossAmount: number) {
  return Math.abs(grossFromNet(netAmount, vatRate) - roundMoney(grossAmount)) <= 0.01;
}
