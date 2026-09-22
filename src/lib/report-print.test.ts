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

  it("používá segmentované pruhy, které zůstávají čitelné i v tisku", () => {
    const source = report();
    const block = lastPrintBlock(minimal());
    expect(source).toContain('className="report-segmented-bar"');
    expect(source).toContain('className="report-payment-bar"');
    expect(source).not.toContain('className="donut"');
    expect(block).toContain(".report-segmented-bar");
    expect(block).toContain(".report-payment-bar");
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
    for (const selector of [".report-card", ".report-column-chart", ".report-payment-metrics", ".report-status-card"]) {
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

describe("pracovní plocha reportů", () => {
  it("řadí Tržby do zarovnaných dvojic a centruje graf s jediným měsícem", () => {
    const source = report();
    const css = minimal();
    for (const card of ["report-revenue-primary-card", "report-revenue-customers-card", "report-revenue-yoy-card", "report-revenue-average-card"]) {
      expect(source).toContain(card);
      expect(css).toContain(`.${card}{grid-column:`);
    }
    expect(source).toContain('report.monthly.length === 1 ? " is-single"');
    expect(source).toContain('report.yoy_monthly.length === 1 ? " is-single"');
    expect(source).toContain('className="report-revenue-average-hero"');
    expect(source).toContain('className="report-average-icon" aria-hidden="true"');
    expect(source).toContain('money(report.invoice_count ? Number(report.total) / report.invoice_count : 0, currency)');
    expect(source).not.toContain('Hodnota a počet podle měsíce');
    expect(source).not.toContain('<th>Průměr</th>');
    expect(css).toContain('.report-revenue-chart.is-single .report-column-group{flex:1 0 100%}');
    expect(css).toContain('.report-revenue-chart.is-single .report-column-values{display:grid;width:min(100%,176px)');
    expect(css).toContain('.report-revenue-average-hero{margin:14px;border:1px solid #dcebe0;border-radius:12px;background:linear-gradient(');
    expect(css).not.toContain('.report-revenue-average-hero::before');
    expect(lastPrintBlock(css)).toContain('.report-revenue-average-hero {');
    expect(css).toContain('.report-revenue-layout .report-revenue-card{grid-column:1;grid-row:auto}');
  });

  it("zarovnává karty DPH na desktopu a na tabletu je skládá bez půlřádku", () => {
    const source = report();
    const css = minimal();
    expect(source).toContain('className="report-workspace-grid report-vat-grid"');
    expect(source).toContain('report-span-4 report-vat-structure-card');
    expect(css).toContain('.report-vat-grid{align-items:stretch}');
    expect(css).toContain('.report-vat-structure-card .report-vat-bars{flex:1;align-content:space-evenly}');
    expect(css).toContain('.report-vat-grid .report-span-4{grid-column:span 12}');
  });

  it("roztahuje graf doby úhrady k sousední kartě a na mobilu nechává hodnotu viditelnou", () => {
    const source = report();
    const css = minimal();
    expect(source).toContain('report-span-7 report-dso-card');
    expect(source).toContain('report-dso-chart${report.dso_monthly.length === 1 ? " is-single" : ""}');
    expect(css).toContain('.report-dso-card{display:flex;flex-direction:column;align-self:stretch}');
    expect(css).toContain('.report-dso-chart.report-dso-chart{height:auto;min-height:220px;flex:1 1 auto}');
    expect(css).toContain('.report-dso-chart .report-column-values{display:flex}');
  });

  it("v Tržbách drží přesné částky v obou grafech viditelné i na mobilu", () => {
    const source = report();
    const css = minimal();
    expect(source.match(/report-column-chart(?: compact)? report-revenue-chart/g) ?? []).toHaveLength(2);
    expect(source).toContain('className="report-column-values"><small className="issued"');
    expect(source).toContain('className="report-column-values"><small className="prior"');
    expect(css).toContain(".report-revenue-chart .report-column-values{display:grid}");
    expect(css).toContain(".report-revenue-chart .report-column-group{flex:0 0 112px");
    expect(css).toContain(".report-revenue-layout{grid-template-columns:minmax(0,1fr)}");
  });

  it("zachovává pět účetních údajů a přístupné zkratky období", () => {
    const source = report();
    for (const label of ["Základ bez DPH", "DPH", "Fakturováno celkem", "Přijaté úhrady", "Otevřené pohledávky"]) {
      expect(source).toContain(`"${label}"`);
    }
    expect(source).toContain('role="group" aria-label="Rychlá volba období"');
    expect(source.match(/type="button" onClick=\{\(\) => preset\(/g) ?? []).toHaveLength(3);
  });

  it("má záložky ve správném pořadí a výchozí záložku Tržby", () => {
    const source = report();
    expect(source).toContain('useState<ReportTab>("revenue")');
    const labels = ["Tržby", "DPH", "Pohledávky", "Platby"];
    let previous = -1;
    for (const label of labels) {
      const position = source.indexOf(`label: "${label}"`);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
  });

  it("propojuje přístupné záložky s panely a podporuje klávesnici", () => {
    const source = report();
    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tab"');
    expect(source.match(/role="tabpanel"/g) ?? []).toHaveLength(4);
    expect(source).toContain("aria-selected={activeTab === tab.id}");
    expect(source).toContain("aria-controls={`report-panel-${tab.id}`}");
    expect(source).toContain("onKeyDown={(event) => moveReportTab(event, index)}");
  });

  it("ponechává všechny panely v DOM a při tisku je zobrazí", () => {
    const source = report();
    expect(source.match(/className={`report-tab-panel/g) ?? []).toHaveLength(4);
    const block = lastPrintBlock(minimal());
    expect(block).toMatch(/\.report-tab-panel\s*\{[\s\S]*?display: block !important/);
  });

  it("nenatahuje reportové karty pevnou minimální výškou", () => {
    const css = minimal();
    const cardRule = css.match(/\.report-card\{([^}]*)\}/)?.[1] ?? "";
    expect(cardRule).not.toContain("min-height");
    expect(css).toContain(".report-workspace-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));align-items:start");
  });

  it("na mobilu posouvá účetní tabulky uvnitř karty", () => {
    const css = minimal();
    expect(css).toMatch(/\.report-accounting-table\{[^}]*max-width:100%[^}]*overflow-x:auto/);
    expect(css).toContain(".report-accounting-table table{min-width:620px}");
  });
});
