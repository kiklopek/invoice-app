import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Skutečný incident (22. 9.): next.config.js trasoval fonty pro PDF fakturu
// přímo z node_modules/pdfjs-dist/standard_fonts/*.ttf. pnpm ale
// node_modules/pdfjs-dist ukládá jako symlink do svého store, a Vercel
// odmítl takový výstup zabalit ("invalid deployment package -- files in
// symlinked directories"). Nebylo to jedno selhání -- KAŽDÝ produkční deploy
// od chvíle, kdy se ta cesta objevila, tise selhal, aniž by si toho kdokoli
// všiml (GitHub check hlásil chybu, ale nikdo se na ni nedíval).
//
// Řešení: font je vendorovaný v assets/fonts/ jako obyčejný soubor v repu.
// Testy hlídají, že se to nevrátí -- ani u fontu, ani u žádné budoucí cesty
// trasovanou přes symlinkovaný balíček v node_modules.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("bezpečnost trasování výstupu pro Vercel", () => {
  it("vendorované fonty jsou obyčejné soubory, ne symlinky", () => {
    for (const name of ["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf"]) {
      const path = join(process.cwd(), "assets", "fonts", name);
      expect(existsSync(path), `${name} chybí v assets/fonts`).toBe(true);
      expect(lstatSync(path).isSymbolicLink(), `${name} je symlink -- to je přesně to, co shodilo produkci`).toBe(false);
      expect(lstatSync(path).size, `${name} je prázdný soubor`).toBeGreaterThan(10_000);
    }
  });

  it("next.config.js čte PDF fonty z vendorované cesty, ne z node_modules", () => {
    const config = read("next.config.js");
    expect(config).toContain("./assets/fonts/LiberationSans-Regular.ttf");
    expect(config).toContain("./assets/fonts/LiberationSans-Bold.ttf");
    expect(config).not.toMatch(/outputFileTracingIncludes[\s\S]*node_modules\/pdfjs-dist/);
  });

  it("invoice-pdf.ts nečte font přes require.resolve do pdfjs-dist", () => {
    // require.resolve("pdfjs-dist/package.json") byl přesně ten dynamický
    // požadavek, kvůli kterému bylo nutné trasovat symlinkovanou cestu.
    // Balíček se smí zmínit v komentáři (vysvětluje historii), nesmí se ale
    // importovat ani vyhledávat přes require.resolve.
    const source = read("src/lib/invoice-pdf.ts");
    expect(source).not.toMatch(/require.*resolve.*pdfjs-dist/);
    expect(source).not.toMatch(/from ["']pdfjs-dist/);
    expect(source).toContain("process.cwd()");
  });

  // POZOR, co tenhle test NEtvrdí: že trasování ze symlinkované cesty v
  // node_modules je vždy rozbité. Není -- ocrRuntimeFiles níže trasuje
  // @tesseract.js-data/ces a @tesseract.js-data/eng, což jsou symlinky
  // stejně jako byl pdfjs-dist, a ten deploy (commit 2b12552) prošel.
  // Přesný mechanismus incidentu nebyl zjištěn, jen ověřený fix pro jeden
  // konkrétní případ. Test proto hlídá jen to, co je jisté: font se nevrátí
  // na node_modules/pdfjs-dist. Kdyby se OCR trasování jednou rozbilo
  // stejným způsobem, patří sem jako další, ne jako rozšíření tohohle.
  it("PDF fonty se nevrací na trasování přes node_modules/pdfjs-dist", () => {
    const config = read("next.config.js");
    expect(config).not.toMatch(/outputFileTracingIncludes[\s\S]*node_modules\/pdfjs-dist/);
  });
});
