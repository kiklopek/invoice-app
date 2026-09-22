// Kontrast podle WCAG 2.1. Barvy v aplikaci se dřív volily od oka a čtyři
// dvojice spadly pod povolený poměr -- na písmu o velikosti 8 až 11 px,
// na které se účetní dívá osm hodin denně.

export function parseHex(value: string): [number, number, number] {
  const hex = value.trim().replace(/^#/, "");
  const full = hex.length === 3 ? [...hex].map(char => char + char).join("") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Neplatná barva: ${value}`);
  return [0, 2, 4].map(offset => Number.parseInt(full.slice(offset, offset + 2), 16)) as [number, number, number];
}

/** Relativní jas podle WCAG: sRGB kanály se nejdřív linearizují. */
export function relativeLuminance(color: string): number {
  const [r, g, b] = parseHex(color).map(channel => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Poměr 1–21. AA vyžaduje 4,5:1 pro běžný text a 3:1 pro velký. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}
