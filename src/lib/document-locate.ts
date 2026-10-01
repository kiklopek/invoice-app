import type { OcrBoundingBox, OcrFieldName } from "./invoice-ocr";

/** Položka textové vrstvy stránky s boxem normalizovaným do 0..1 (počátek vlevo nahoře). */
export type LayoutTextItem = { text: string; bounds: OcrBoundingBox };

export type LocateKind = "amount" | "date" | "ico" | "digits" | "text";

export type LocatedValue = { bounds: OcrBoundingBox; text: string; matches: number };

const FIELD_KINDS: Partial<Record<OcrFieldName, LocateKind>> = {
  amount: "amount",
  amount_without_vat: "amount",
  issue_date: "date",
  due_date: "date",
  counterparty_ico: "ico",
  variable_symbol: "digits",
  invoice_number: "text",
  counterparty_name: "text",
  counterparty_dic: "text",
  counterparty_email: "text",
};

/** Sazba DPH a měna se v dokladu hledat nedají spolehlivě -- raději nic než odhad. */
export function locateKindForField(field: OcrFieldName): LocateKind | null {
  return FIELD_KINDS[field] ?? null;
}

/** Co se má v dokladu ukázat. `bounds` z OCR má přednost; bez něj se hodnota hledá v textové vrstvě. */
export type DocumentHighlight = {
  page: number;
  bounds: OcrBoundingBox | null;
  text?: string;
  value?: string | number;
  kind?: LocateKind | null;
};

type HighlightOrigin = { page: number; text: string; method: string; bounds?: OcrBoundingBox | null };

/**
 * Z pole formuláře (zdroje nebo hovered kandidáta) udělá zadání pro náhled.
 * Box se bere jen od zdroje, který hodnotu skutečně přečetl: odvozený zdroj
 * ("derived") nese řádek JINÉ hodnoty, ze které se pole dopočetlo, a měna sdílí
 * box s částkou -- ani jedno se nesmí vykreslit jako místo hodnoty.
 */
export function documentHighlightFor(input: {
  field: OcrFieldName;
  value?: string | number;
  source?: HighlightOrigin;
  candidate?: HighlightOrigin & { value: string | number };
}): DocumentHighlight | null {
  if (input.field === "currency") return null;
  const origin = input.candidate ?? input.source;
  if (!origin) return null;
  const kind = locateKindForField(input.field);
  const bounds = origin.method === "derived" ? null : origin.bounds ?? null;
  return { page: origin.page, bounds, text: origin.text, value: input.candidate ? input.candidate.value : input.value, kind };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Normalizovaný box -> procenta pro absolutně pozicovaný overlay nad stránkou. */
export function boundsToPercentStyle(bounds: OcrBoundingBox) {
  const left = clamp01(bounds.x);
  const top = clamp01(bounds.y);
  const width = clamp01(bounds.x + bounds.width) - left;
  const height = clamp01(bounds.y + bounds.height) - top;
  const pct = (value: number) => `${Math.round(value * 10000) / 100}%`;
  return { left: pct(left), top: pct(top), width: pct(width), height: pct(height) };
}

type Viewport = { transform: number[]; width: number; height: number };

function multiply(m1: number[], m2: number[]) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Box položky textové vrstvy pdf.js ve viewportu stránky, normalizovaný do 0..1.
 * Jde přes transformaci viewportu, takže sedí i u otočených stránek a stránek
 * s posunutým MediaBoxem; width/height jsou v jednotkách uživatelského prostoru.
 */
export function textItemBounds(itemTransform: number[], itemWidth: number, itemHeight: number, viewport: Viewport): OcrBoundingBox {
  const tx = multiply(viewport.transform, itemTransform);
  const scale = Math.hypot(viewport.transform[0], viewport.transform[1]) || 1;
  const along = Math.hypot(tx[0], tx[1]) || 1;
  const up = Math.hypot(tx[2], tx[3]) || 1;
  const w = itemWidth * scale;
  const h = itemHeight * scale;
  const dx = (tx[0] / along) * w;
  const dy = (tx[1] / along) * w;
  const ux = (tx[2] / up) * h;
  const uy = (tx[3] / up) * h;
  const xs = [tx[4], tx[4] + dx, tx[4] + ux, tx[4] + dx + ux];
  const ys = [tx[5], tx[5] + dy, tx[5] + uy, tx[5] + dy + uy];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX / viewport.width,
    y: minY / viewport.height,
    width: (Math.max(...xs) - minX) / viewport.width,
    height: (Math.max(...ys) - minY) / viewport.height,
  };
}

const normalizeText = (value: string) => value
  .normalize("NFD").replace(/\p{M}+/gu, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function amountReadings(token: string): number[] {
  const compact = token.replace(/[\s ]/g, "");
  const readings = new Set<number>();
  const push = (text: string) => { const n = Number(text); if (Number.isFinite(n)) readings.add(Math.round(n * 100)); };
  const lastDot = compact.lastIndexOf(".");
  const lastComma = compact.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    push(compact.split(thousands).join("").replace(decimal, "."));
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = compact.split(sep);
    // Jediný oddělovač: buď desetinný, nebo tisícový ("1.234") -- platí obě čtení.
    if (parts.length === 2) push(`${parts[0]}.${parts[1]}`);
    if (parts.slice(1).every(part => part.length === 3)) push(parts.join(""));
  } else push(compact);
  return [...readings];
}

function matchesAmount(text: string, wanted: number) {
  const tokens = text.match(/\d{1,3}(?:[\s .,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g) ?? [];
  return tokens.some(token => amountReadings(token).includes(wanted));
}

function parseDate(value: string): string | null {
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const cz = /^\s*(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4})\s*$/.exec(value);
  return cz ? `${cz[3]}-${cz[2].padStart(2, "0")}-${cz[1].padStart(2, "0")}` : null;
}

function matchesDate(text: string, wantedIso: string) {
  const dates = [
    ...[...text.matchAll(/(?<!\d)(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4})(?!\d)/g)].map(m => `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`),
    ...[...text.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)].map(m => `${m[1]}-${m[2]}-${m[3]}`),
  ];
  return dates.includes(wantedIso);
}

function matchesDigits(text: string, wanted: string, allowSpaces: boolean) {
  const runs = text.match(allowSpaces ? /\d(?:[\s ]?\d)*/g : /\d+/g) ?? [];
  return runs.some(run => run.replace(/\D/g, "") === wanted);
}

function matchesText(text: string, wanted: string) {
  return ` ${normalizeText(text)} `.includes(` ${wanted} `);
}

/**
 * Najde hodnotu pole v textové vrstvě stránky, i když je v dokladu zapsaná jinak
 * (123 100,20 vs 123100.2; 23. 9. 2026 vs 2026-09-23). Vrací box první shody
 * v pořadí čtení, nebo null. Nikdy nehádá: jednoznačně nesrovnatelné hodnoty
 * (krátká čísla, krátké texty) se nehledají vůbec.
 */
export function locateValueInLayout(value: string | number, kind: LocateKind, items: LayoutTextItem[]): LocatedValue | null {
  const raw = String(value).trim();
  if (!raw) return null;
  let test: ((text: string) => boolean) | null = null;
  if (kind === "amount") {
    const readings = amountReadings(raw.replace(/[^\d.,\s -]/g, "").trim());
    const wanted = typeof value === "number" ? Math.round(value * 100) : readings[0];
    if (wanted === undefined || !Number.isFinite(wanted) || wanted <= 0) return null;
    // Celé číslo pod 100 by sedělo na čísla řádků, sazby a stránkování.
    if (wanted < 10000 && wanted % 100 === 0) return null;
    test = text => matchesAmount(text, wanted);
  } else if (kind === "date") {
    const iso = parseDate(raw);
    if (!iso) return null;
    test = text => matchesDate(text, iso);
  } else if (kind === "ico") {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 6 || digits.length > 8) return null;
    const wanted = digits.padStart(8, "0");
    test = text => matchesDigits(text, wanted, true) || matchesDigits(text, digits, true);
  } else if (kind === "digits") {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 3 || digits !== raw) return null;
    test = text => matchesDigits(text, digits, false);
  } else {
    const wanted = normalizeText(raw);
    if (wanted.replace(/ /g, "").length < 3) return null;
    test = text => matchesText(text, wanted);
  }
  const found: Array<{ bounds: OcrBoundingBox; text: string }> = [];
  for (const size of [1, 2, 3]) {
    for (let start = 0; start + size <= items.length; start++) {
      const slice = items.slice(start, start + size);
      const text = slice.map(entry => entry.text).join(" ");
      // Širší okno se bere, jen když tutéž shodu nedává užší (už nalezená položka).
      if (size > 1 && (test(slice[0].text) || test(slice[size - 1].text))) continue;
      if (!test(text) && !(size > 1 && test(slice.map(entry => entry.text).join("")))) continue;
      const minX = Math.min(...slice.map(entry => entry.bounds.x));
      const minY = Math.min(...slice.map(entry => entry.bounds.y));
      found.push({
        text,
        bounds: {
          x: minX,
          y: minY,
          width: Math.max(...slice.map(entry => entry.bounds.x + entry.bounds.width)) - minX,
          height: Math.max(...slice.map(entry => entry.bounds.y + entry.bounds.height)) - minY,
        },
      });
    }
    if (found.length) break;
  }
  return found.length ? { ...found[0], matches: found.length } : null;
}
