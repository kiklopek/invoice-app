/** Presentation only: never use formatted or compact values in calculations. */
export function exactMoney(value: number, currency = "CZK") {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

export function summaryMoney(value: number, currency = "CZK") {
  if (!Number.isFinite(value)) return { text: "—", exact: "—", compact: false };
  const exact = exactMoney(value, currency);
  const magnitude = Math.abs(value);
  if (magnitude < 1_000_000) return { text: exact, exact, compact: false };
  // Promote before rounding would produce “1 000 mil.” or “1 000 mld.”.
  const [divisor, unit] = magnitude >= 999_999_500_000
    ? [1e12, "bil."] as const
    : magnitude >= 999_999_500
      ? [1e9, "mld."] as const
      : [1e6, "mil."] as const;
  const symbol = new Intl.NumberFormat("cs-CZ", { style: "currency", currency })
    .formatToParts(0).find(part => part.type === "currency")?.value ?? currency;
  const number = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 3 }).format(value / divisor);
  return { text: `${number} ${unit} ${symbol}`, exact, compact: true };
}

export function compactMoneyLabel(value: number, currency = "CZK") {
  return summaryMoney(value, currency).text;
}

/** Ordered fitting alternatives; source amounts and exported values remain exact. */
export function responsiveMoneyOptions(value: number, currency = "CZK"): string[] {
  const exact = exactMoney(value, currency);
  if (!Number.isFinite(value) || Math.abs(value) < 1000) return [exact];
  const symbol = new Intl.NumberFormat("cs-CZ", { style: "currency", currency })
    .formatToParts(0).find(part => part.type === "currency")?.value ?? currency;
  const units = [[1e12, "bil."], [1e9, "mld."], [1e6, "mil."], [1e3, "tis."]] as const;
  const options = [exact];
  for (const precision of [3, 2, 1, 0]) {
    // Promote when rounding would otherwise say 1 000 tis./mil./mld.
    const [divisor, unit] = units.find(([scale]) => Math.abs(value) >= scale - .5 * scale / 10 ** precision) ?? units[3];
    const number = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: precision }).format(value / divisor);
    options.push(`${number} ${unit} ${symbol}`);
  }
  return [...new Set(options)];
}
