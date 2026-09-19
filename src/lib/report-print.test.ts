import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const report = () => source("src/app/(workspace)/reports/reports-client.tsx");
const minimal = () => source("src/app/minimal.css");

/** Vrátí tělo posledního @media print bloku v souboru (počítá závorky). */
function lastPrintBlock(css: string) {
  const start = css.search(/@media print\s*\{(?![\s\S]*@media print\s*\{)/);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let index = css.indexOf("{", start); index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start, index + 1);
    }
  }
  throw new Error("neuzavřený @media print blok");
}

describe("tisk reportů", () => {
  it("nabízí tlačítko tisku, které nejede nad nehotovým reportem", () => {
    expect(report()).toContain('disabled={loading || !report} onClick={() => window.print()}');
  });

  it("tiskne hlavičku s firmou, obdobím a aktivními filtry", () => {
    const source = report();
    expect(source).toContain('className="report-print-cover"');
    expect(source).toContain('className="report-print-footer"');
    expect(source).toContain("profile?.companyName");
    expect(source).toContain("dateBasisNames[dateBasis]");
    expect(source).toContain("selectedStatus");
    expect(source).toContain("selectedCustomer");
  });

  it("nespoléhá na fixní opakovanou hlavičku, která přetékala do obsahu", () => {
    expect(report()).not.toContain("report-print-running-header");
    expect(minimal()).not.toContain("report-print-running-header");
  });

  it("dává každému koláčovému grafu tiskové SVG, protože .donut je v tisku skrytý", () => {
    const source = report();
    const donuts = source.match(/className="donut"/g) ?? [];
    const printDonuts = source.match(/<PrintableDonut/g) ?? [];
    expect(donuts.length).toBeGreaterThan(0);
    expect(printDonuts.length).toBe(donuts.length);
  });

  it("má jediný autoritativní @media print blok a ten leží na konci minimal.css", () => {
    const css = minimal();
    expect(css.match(/@media print\s*\{/g) ?? []).toHaveLength(1);
    const block = lastPrintBlock(css);
    expect(css.trim().endsWith(block)).toBe(true);
    expect(source("src/app/globals.css")).not.toMatch(/@media print\{[^}]*display/);
  });

  it("skrývá navigaci, filtry, tlačítka a dekorativní pozadí reportu", () => {
    const block = lastPrintBlock(minimal());
    for (const selector of [
      ".sidebar",
      ".mobile-navigation-shell",
      ".report-area-background",
      ".report-screen-header",
      ".section-actions",
      ".report-filters",
      ".btn",
    ]) {
      expect(block).toContain(selector);
    }
    expect(block).toContain("display: none !important");
  });

  it("vynucuje světlý papír bez stínů přes celou šířku stránky", () => {
    const css = minimal();
    const block = lastPrintBlock(css);
    expect(css).toContain("size: A4 portrait");
    expect(block).toContain("color-scheme: light !important");
    expect(block).toContain("background: #fff !important");
    expect(block).toContain("box-shadow: none !important");
  });

  it("nenechá karty a grafy zlomit přes stránku", () => {
    const block = lastPrintBlock(minimal());
    expect(block).toContain("break-inside: avoid");
    expect(block).toContain("page-break-inside: avoid");
    for (const selector of [".analytics-card", ".donut-wrap", ".monthly-chart", ".report-metrics"]) {
      expect(block).toContain(selector);
    }
  });

  it("opakuje hlavičku tabulky na každé stránce", () => {
    const block = lastPrintBlock(minimal());
    expect(block).toContain("thead { display: table-header-group !important; }");
    expect(block).toContain("tfoot { display: table-footer-group !important; }");
  });

  it("nenechává v tiskovém CSS pravidla pro už neexistující prvky", () => {
    const block = lastPrintBlock(minimal());
    const tsx = readFileSync(join(process.cwd(), "src/app/(workspace)/reports/reports-client.tsx"), "utf8");
    for (const dead of [".debtor-table", ".aging-report", ".report-aging-card", ".report-print-table-spacer"]) {
      expect(block).not.toContain(dead);
      expect(tsx).not.toContain(dead.slice(1));
    }
  });
});
