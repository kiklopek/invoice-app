import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const packageJson = () => JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

// Audit tyhle čtyři balíčky označil za zbytečné relikty k odstranění.
// Není to pravda a odstranění by tiše rozbilo OCR v produkci: všechny
// čtyři jsou běhové závislosti tesseract.js a Next.js je trasuje do
// bundlu routy /api/invoices/extract. Explicitní zápis je připíná na
// konkrétní verzi. Tenhle test existuje proto, aby je příště nikdo
// "neuklidil" s odkazem na ten samý audit.
const TESSERACT_RUNTIME_DEPS: Record<string, string> = {
  "node-fetch": "Běhová závislost tesseract.js; je v trasovaném bundlu OCR routy.",
  "regenerator-runtime": "Totéž -- tesseract.js ji potřebuje za běhu, není to relikt Babelu v našem kódu.",
  "is-url": "Totéž; malá, ale tesseract.js ji volá.",
  "bmp-js": "Totéž; tesseract.js čte přes ni BMP vstupy.",
};

describe("závislosti, které vypadají zbytečně, ale nejsou", () => {
  it("keeps every tesseract runtime dependency pinned", () => {
    const { dependencies } = packageJson();
    for (const name of Object.keys(TESSERACT_RUNTIME_DEPS)) {
      expect(dependencies?.[name], `${name}: ${TESSERACT_RUNTIME_DEPS[name]}`).toBeTruthy();
    }
  });

  it("pins them to an exact version, so an OCR bundle cannot drift", () => {
    const { dependencies } = packageJson();
    for (const name of Object.keys(TESSERACT_RUNTIME_DEPS)) {
      expect(dependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("explains each one, so the reason outlives whoever wrote it", () => {
    for (const reason of Object.values(TESSERACT_RUNTIME_DEPS)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
