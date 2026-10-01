import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Náhled dokladu bere worker, cmaps, fonty a WASM dekodéry z public/pdfjs/ (CSP
// nepouští CDN). Po upgradu pdfjs-dist je třeba je znovu zkopírovat:
// node scripts/sync-pdfjs-assets.mjs
describe("public/pdfjs odpovídá nainstalovanému pdfjs-dist", () => {
  it("worker: stejná velikost jako v balíčku", () => {
    expect(statSync(join(process.cwd(), "public/pdfjs/pdf.worker.min.mjs")).size)
      .toBe(statSync(join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.mjs")).size);
  });
  for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    it(`${dir}: stejné soubory ve stejné velikosti`, () => {
      const source = join(process.cwd(), "node_modules/pdfjs-dist", dir);
      const copy = join(process.cwd(), "public/pdfjs", dir);
      expect(existsSync(copy), `${copy} chybí`).toBe(true);
      for (const name of readdirSync(copy)) {
        expect(statSync(join(copy, name)).size, name).toBe(statSync(join(source, name)).size);
      }
      // quickjs-eval (skripty uvnitř PDF) se záměrně nekopíruje.
      const expected = readdirSync(source).filter(name => !name.startsWith("quickjs-eval"));
      expect(readdirSync(copy).sort()).toEqual(expected.sort());
    });
  }
});
