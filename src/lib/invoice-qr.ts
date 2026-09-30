import "server-only";

import jsQR from "jsqr";
import sharp from "sharp";
import { parseSpayd, type ParsedSpayd } from "@/lib/czech-payment";
import type { ExactSourceReading } from "@/lib/invoice-ocr-sources";

// QR platba (SPAYD) vytištěná na faktuře je přesný zdroj pro částku k úhradě,
// variabilní symbol, měnu a splatnost -- banka ji přečte strojově, takže ji
// vystavitel musel vyplnit správně, jinak by mu nikdo nezaplatil.

const MAX_DECODE_PIXELS = 12_000_000;

async function rawRgba(bytes: Uint8Array, width?: number) {
  const pipeline = sharp(bytes, { failOn: "error", limitInputPixels: 50_000_000 }).rotate().flatten({ background: "#ffffff" });
  const resized = width ? pipeline.resize({ width, withoutEnlargement: true }) : pipeline;
  const { data, info } = await resized.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}

function decodeRegion(image: { data: Uint8ClampedArray; width: number; height: number }) {
  const found = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
  return found?.data ? [found.data] : [];
}

// jsQR vrací nejvýše jeden kód na obrázek. QR platba bývá v dolní části
// stránky a bývá malá, proto se kromě celé stránky zkouší i její čtvrtiny.
export async function decodeQrCodesFromImage(bytes: Uint8Array): Promise<string[]> {
  try {
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    const pixels = (metadata.width ?? 0) * (metadata.height ?? 0);
    if (!pixels) return [];
    const image = await rawRgba(bytes, pixels > MAX_DECODE_PIXELS ? 2400 : undefined);
    const codes = new Set(decodeRegion(image));
    const halfWidth = Math.floor(image.width / 2);
    const halfHeight = Math.floor(image.height / 2);
    for (const [left, top] of [[0, 0], [halfWidth, 0], [0, halfHeight], [halfWidth, halfHeight]]) {
      const width = left ? image.width - halfWidth : halfWidth;
      const height = top ? image.height - halfHeight : halfHeight;
      if (width < 50 || height < 50) continue;
      const region = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row += 1) {
        const start = ((top + row) * image.width + left) * 4;
        region.set(image.data.subarray(start, start + width * 4), row * width * 4);
      }
      for (const code of decodeRegion({ data: region, width, height })) codes.add(code);
    }
    return [...codes];
  } catch {
    // Nečitelný obrázek QR kód prostě nemá; vytěžení to nesmí shodit.
    return [];
  }
}

function spaydEvidence(payment: ParsedSpayd) {
  return [
    payment.amount !== null ? `AM:${payment.amount.toFixed(2)}` : "",
    payment.currency ? `CC:${payment.currency}` : "",
    payment.variableSymbol ? `X-VS:${payment.variableSymbol}` : "",
    payment.dueDate ? `DT:${payment.dueDate.replace(/-/g, "")}` : "",
  ].filter(Boolean).join("*");
}

// Z nalezených QR kódů udělá přesný zdroj. Víc různých QR plateb na jednom
// dokumentu (např. záloha a doplatek) je rozpor, který se nerozhoduje.
export function spaydToExactReading(codes: string[]): ExactSourceReading | null {
  const payments = codes.map(code => parseSpayd(code)).filter((payment): payment is ParsedSpayd => payment !== null);
  if (!payments.length) return null;
  const distinct = new Map(payments.map(payment => [spaydEvidence(payment) + payment.iban, payment]));
  if (distinct.size > 1) {
    return {
      method: "qr",
      label: "QR platba",
      values: {},
      warnings: ["Dokument obsahuje více různých QR plateb. Částka ani VS z nich nebyly převzaty – zkontrolujte je ručně."],
    };
  }
  const payment = payments[0];
  const values: ExactSourceReading["values"] = {};
  if (payment.amount !== null) values.amount = payment.amount;
  if (payment.variableSymbol) values.variable_symbol = payment.variableSymbol;
  if (payment.currency) values.currency = payment.currency;
  if (payment.dueDate) values.due_date = payment.dueDate;
  const evidence = `QR platba ${spaydEvidence(payment)}`.slice(0, 240);
  return {
    method: "qr",
    label: "QR platba",
    values,
    evidence: Object.fromEntries(Object.keys(values).map(field => [field, evidence])),
    warnings: [],
  };
}
