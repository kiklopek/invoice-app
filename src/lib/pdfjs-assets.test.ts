import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Náhled dokladu bere worker, cmaps, fonty a WASM dekodéry z public/pdfjs/ (CSP
// nepouští CDN). Po upgradu pdfjs-dist je třeba je znovu zkopírovat:
// node scripts/sync-pdfjs-assets.mjs
// Git may check text assets out with CRLF on Windows. Compare complete
// contents rather than sizes; binary files must still match byte for byte.
function assetBytes(path: string) {
  const bytes = readFileSync(path);
  return /\.(?:mjs|js)$/.test(path) || /LICENSE[^/\\]*$/.test(path)
    ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g,"\n")) : bytes;
}
describe("public/pdfjs odpovídá nainstalovanému pdfjs-dist", () => {
  it("worker: stejná velikost jako v balíčku", () => {
    expect(assetBytes(join(process.cwd(), "public/pdfjs/pdf.worker.min.mjs"))
      .equals(assetBytes(join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.mjs")))).toBe(true);
  });
  for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    it(`${dir}: stejné soubory ve stejné velikosti`, () => {
      const source = join(process.cwd(), "node_modules/pdfjs-dist", dir);
      const copy = join(process.cwd(), "public/pdfjs", dir);
      expect(existsSync(copy), `${copy} chybí`).toBe(true);
      for (const name of readdirSync(copy)) {
        expect(assetBytes(join(copy, name)).equals(assetBytes(join(source, name))), name).toBe(true);
      }
      // quickjs-eval (skripty uvnitř PDF) se záměrně nekopíruje.
      const expected = readdirSync(source).filter(name => !name.startsWith("quickjs-eval"));
      expect(readdirSync(copy).sort()).toEqual(expected.sort());
    });
  }
});
