// Decimal input -> minor units, rounded half away from zero. No binary multiplication.
export function minorUnits(value: number | string): number {
  const raw = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(raw);
  if (!match) throw new Error("Neplatná peněžní částka.");
  const exponent = Number(match[4] ?? 0);
  if (Math.abs(exponent) > 30) throw new Error("Částka je mimo podporovaný rozsah.");
  const fraction = match[3] ?? "";
  const digits = BigInt(match[2] + fraction);
  const scale = fraction.length - exponent - 2;
  const divisor = 10n ** BigInt(Math.max(0, scale));
  const rounded = scale > 0 ? (digits + divisor / 2n) / divisor : digits * 10n ** BigInt(-scale);
  const result = Number(match[1] === "-" ? -rounded : rounded);
  if (!Number.isSafeInteger(result)) throw new Error("Částka je mimo podporovaný rozsah.");
  return result;
}

export function money(value: number | string) { return minorUnits(value) / 100; }

export function multiplyRatio(value: number, numerator: number, denominator: number) {
  const product = BigInt(minorUnits(value)) * BigInt(numerator);
  const divisor = BigInt(denominator);
  if (divisor <= 0n) throw new Error("Neplatný poměr.");
  const absolute = product < 0n ? -product : product;
  const rounded = (absolute + divisor / 2n) / divisor;
  return Number(product < 0n ? -rounded : rounded) / 100;
}
