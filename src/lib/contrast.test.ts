import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseHex, relativeLuminance } from "./contrast";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("výpočet kontrastu", () => {
  it("matches the reference values from the WCAG definition", () => {
    // Krajní hodnoty: černá na bílé je 21:1, stejná barva na sobě 1:1.
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });

  it("is symmetric, because the ratio does not care which is text", () => {
    expect(contrastRatio("#245f42", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#245f42"), 5);
  });

  it("reads short and long hex the same", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(relativeLuminance("#fff")).toBeCloseTo(relativeLuminance("#ffffff"), 6);
  });

  it("refuses input it cannot read instead of guessing", () => {
    for (const value of ["", "#12", "zelená", "#gggggg"]) {
      expect(() => parseHex(value), value).toThrow();
    }
  });
});

// Čtyři dvojice v aplikaci byly pod povoleným poměrem -- a všechny na písmu
// o velikosti 8 až 12 px, na které se účetní dívá osm hodin denně. Tenhle
// test drží opravené hodnoty na místě; bez něj se barva "jen trochu
// zesvětlí" při příštím ladění vzhledu a nikdo si toho nevšimne.
describe("barvy v aplikaci splňují WCAG AA", () => {
  const AA_NORMAL = 4.5;

  const pairs: { name: string; foreground: string; background: string; was: number }[] = [
    { name: "hlavička tabulky", foreground: "#69756d", background: "#f7f8f6", was: 3.86 },
    { name: "sekundární text v buňce", foreground: "#717871", background: "#ffffff", was: 2.99 },
    { name: "tlačítko nabídky řádku", foreground: "#717872", background: "#ffffff", was: 2.64 },
    { name: "štítek Čeká na úhradu", foreground: "#94641e", background: "#f8f0df", was: 4.45 },
    { name: "tlumený text na bílé", foreground: "#66736b", background: "#ffffff", was: 4.96 },
    { name: "tlumený text na plátně", foreground: "#66736b", background: "#f5f6f2", was: 4.7 },
  ];

  for (const pair of pairs) {
    it(`${pair.name} má alespoň ${AA_NORMAL}:1 (dřív ${pair.was}:1)`, () => {
      expect(contrastRatio(pair.foreground, pair.background)).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  }

  it("still uses those colours, so the test is not measuring a fiction", () => {
    const minimal = read("src/app/minimal.css");
    const globals = read("src/app/globals.css");
    expect(minimal).toContain("#69756d");
    expect(minimal).toContain("--amber: #94641e");
    expect(globals).toContain("#717871");
    expect(globals).toContain("#717872");
  });

  it("no longer contains the colours that failed", () => {
    const css = read("src/app/minimal.css").replace(/\/\*[\s\S]*?\*\//g, "") + read("src/app/globals.css");
    for (const failing of ["#909790", "#9aa19b", "#89918a", "#94621f"]) {
      expect(css, failing).not.toContain(failing);
    }
  });
});
