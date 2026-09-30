// Porovnání přesnosti OCR pole po poli: lokální parser vs. AI vs. sloučený
// vícezdrojový výsledek, na složce skutečných PDF.
//
// Spouští se ručně, NIKDY v CI (`pnpm test` bere jen src/):
//
//   OCR_COMPARE_DIR=~/faktury \
//   OCR_COMPARE_ORG_NAME="Moje firma s.r.o." OCR_COMPARE_ORG_ICO=12345678 OCR_COMPARE_ORG_DIC=CZ12345678 \
//   npx vitest run scripts/ocr-compare.test.ts
//
// Volitelně OCR_COMPARE_AI=1 (+ GEMINI_API_KEY): dokumenty se POŠLOU do
// Google Gemini. Jen pro dokumenty, u kterých to smíte udělat.
//
// Ke každému PDF může ležet <jméno>.expected.json s očekávanými hodnotami
// (např. {"invoice_number":"426198","amount":3370}). Pak skript hlásí i
// "špatně + ověřeno" -- jedinou chybu, která nesmí nastat.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { OCR_REVIEW_FIELDS, omitUnverifiedOcrValues, parseInvoiceText, type InvoiceOcrResult, type OcrFieldName } from "@/lib/invoice-ocr";
import { extractInvoiceDocumentText } from "@/lib/invoice-ocr-server";
import { extractInvoiceWithGemini } from "@/lib/invoice-ocr-gemini";
import { mergeOcrSources, ocrValuesAgree, type ExactSourceReading } from "@/lib/invoice-ocr-sources";
import { isdocToExactReading, parseIsdoc } from "@/lib/invoice-isdoc";
import { spaydToExactReading } from "@/lib/invoice-qr";

const directory = process.env.OCR_COMPARE_DIR;
const useAi = process.env.OCR_COMPARE_AI === "1";
const organization = {
  name: process.env.OCR_COMPARE_ORG_NAME ?? "",
  ico: process.env.OCR_COMPARE_ORG_ICO ?? null,
  dic: process.env.OCR_COMPARE_ORG_DIC ?? null,
};

function value(result: InvoiceOcrResult | null, field: OcrFieldName) {
  if (!result) return "";
  return (result.invoice as unknown as Record<string, string | number | undefined>)[field] ?? "";
}

describe.skipIf(!directory)("OCR porovnání na složce PDF", () => {
  it("vypíše tabulku přesnosti", async () => {
    const files = readdirSync(directory!).filter(name => /\.pdf$/i.test(name)).sort();
    const totals = { fields: 0, correct: 0, silentWrong: 0, review: 0 };
    for (const file of files) {
      const bytes = new Uint8Array(readFileSync(join(directory!, file)));
      const text = await extractInvoiceDocumentText({ bytes: bytes.slice(), mime: "application/pdf", timeoutMs: 60_000 });
      const local = parseInvoiceText({ text: text.text, fileUrl: file, organization, ocrConfidence: text.averageConfidence, extraWarnings: text.warnings, layout: text.layout });
      const isdoc = text.isdoc ? parseIsdoc(text.isdoc.xml) : null;
      const qr = spaydToExactReading(text.qrCodes ?? []);
      const exact: ExactSourceReading[] = [...(isdoc && text.isdoc ? [isdocToExactReading(isdoc, organization, text.isdoc.fileName)] : []), ...(qr ? [qr] : [])];
      const ai = useAi ? await extractInvoiceWithGemini({ bytes: bytes.slice(), mime: "application/pdf", fileUrl: file, organization }).catch(error => {
        console.warn(`${file}: AI selhala (${error instanceof Error ? error.message : error})`);
        return null;
      }) : null;
      const merged = mergeOcrSources({ local, ai, exact, organization });
      const form = omitUnverifiedOcrValues(merged);
      const expectedPath = join(directory!, file.replace(/\.pdf$/i, ".expected.json"));
      const expected = existsSync(expectedPath) ? JSON.parse(readFileSync(expectedPath, "utf8")) as Partial<Record<OcrFieldName, string | number>> : null;

      const rows = OCR_REVIEW_FIELDS.map(field => {
        const status = merged.field_decisions[field]?.status ?? "-";
        const row: Record<string, string | number> = {
          pole: field,
          lokalne: value(local, field),
          ai: useAi ? value(ai, field) : "(vypnuto)",
          vysledek: value(merged, field),
          zdroj: merged.field_sources[field]?.method ?? "",
          stav: `${status}${merged.field_decisions[field]?.needs_confirmation ? " (potvrdit)" : ""}`,
          formular: value(form, field),
        };
        if (expected && field in expected) {
          const want = expected[field]!;
          const got = value(form, field);
          totals.fields += 1;
          const empty = got === "" || got === 0;
          if (!empty && ocrValuesAgree(field, got, want)) totals.correct += 1;
          else if (!empty) totals.silentWrong += 1;
          else totals.review += 1;
          row.ocekavano = want;
          row.hodnoceni = !empty && ocrValuesAgree(field, got, want) ? "OK" : empty ? "k ověření" : "ŠPATNĚ";
        }
        return row;
      });
      console.log(`\n=== ${file} | druh: ${merged.document_kind} | ISDOC: ${isdoc ? "ano" : "ne"} | QR: ${qr ? "ano" : "ne"}`);
      console.table(rows);
      if (merged.warnings.length) console.log(`varování: ${merged.warnings.join(" | ")}`);
    }
    if (totals.fields) {
      console.log(`\nCELKEM polí s očekáváním: ${totals.fields}, správně předvyplněno: ${totals.correct}, k ověření: ${totals.review}, ŠPATNĚ PŘEDVYPLNĚNO: ${totals.silentWrong}`);
    }
  }, 30 * 60_000);
});
