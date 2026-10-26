import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const report = () => source("src/app/(workspace)/reports/reports-client.tsx");
const printDocument = () => source("src/app/(workspace)/reports/report-print-document.tsx");
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
  it("uses the authorized PDF export without printing the application screen", () => {
    expect(report()).toContain("<FinancialReportExport");
    expect(report()).not.toContain("window.print()");
    expect(report()).not.toContain("<ReportPrintDocument");
  });
  it("passes active filters to the common PDF workflow", () => {
    expect(report()).toContain('status: status === "all" ? null : status');
    expect(report()).toContain('customer: customer === "all" ? null : customer');
    expect(source("src/components/financial-report/financial-report-export.tsx")).toContain('fetch("/api/reports/pdf"');
  });

  it("nespoléhá na fixní opakovanou hlavičku, která přetékala do obsahu", () => {
    expect(report()).not.toContain("report-print-running-header");
    expect(minimal()).not.toContain("report-print-running-header");
  });

  it("používá segmentované pruhy, které zůstávají čitelné i v tisku", () => {
    const source = printDocument();
    const block = lastPrintBlock(minimal());
    expect(source).toContain('className="print-status-bar"');
    expect(source).toContain('className="print-matching-bar"');
    expect(source).not.toContain('className="donut"');
    expect(block).toContain(".print-status-bar");
    expect(block).toContain(".print-matching-bar");
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
      ".report-screen-document",
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

  it("čísluje skutečné stránky patičkou z @page, ne odhadem v dokumentu", () => {
    const css = minimal();
    const block = lastPrintBlock(css);
    // Kapitola dřív měla pevnou výšku přesně jedné A4 a vlastní patičku se
    // "Strana X / Y" spočítanou dopředu. Stačil posun o pár milimetrů (jiné
    // písmo na Macu, okraje v dialogu) a každá kapitola se přelila na další
    // list: z reportu na 4 strany jich Chrome vytiskl 6 a čísla nesouhlasila.
    // Patičku proto kreslí prohlížeč na okraj každé skutečné stránky.
    expect(css).toContain('content: "Strana " counter(page) " / " counter(pages);');
    expect(css).toContain("content: var(--print-report-footer");
    expect(printDocument()).toContain('"--print-report-footer"');
    expect(printDocument()).not.toContain("print-report-page-footer");
    expect(block).not.toMatch(/\.print-report-page \{[^}]*height: 264mm/);
    expect(block).not.toMatch(/\.print-report-page \{[^}]*overflow: hidden/);
    // Prázdné horní boxy nic nevytisknou, ale Chrome kvůli nim vynechá své
    // vlastní záhlaví (datum, titulek stránky), které jinak při výchozím
    // nastavení tiskového dialogu přidá. Ověřeno v Chromiu.
    for (const box of ["@top-left", "@top-right"]) {
      expect(css).toMatch(new RegExp(`${box}\\s*\\{\\s*content: "";`));
    }
    expect(block).toContain(".report-tab-panel + .report-tab-panel {");
    expect(block).toContain("break-before: page;");
    expect(block).toContain("page-break-before: always;");
  });

  it("dovolí dlouhým tabulkám pokračovat na další stránce bez rozdělení řádku", () => {
    const block = lastPrintBlock(minimal());
    expect(printDocument()).toContain("print-report-table");
    expect(block).toContain(".report-card.report-table-card");
    expect(block).toContain("break-inside: auto;");
    expect(block).toMatch(/tr\s*\{[\s\S]*?break-inside: avoid/);
  });

  it("skládá tržby i analytické karty pohledávek do tiskových sloupců", () => {
    const block = lastPrintBlock(minimal());
    expect(block).toContain("grid-template-columns: minmax(0, 1.6fr) minmax(52mm, .8fr);");
    expect(block).toContain(".report-revenue-primary-card { grid-column: 1; grid-row: 1; }");
    expect(block).toContain(".report-aging-overview-card { grid-column: span 7 !important; }");
    expect(block).toContain(".report-dso-insight-card { grid-column: span 5 !important; }");
  });

  it("skládá tisk tržeb do nezávislých sloupců bez mezery podle výšky sousední karty", () => {
    const printable = printDocument();
    const block = lastPrintBlock(minimal());
    expect(printable).toContain('className="print-revenue-column print-revenue-primary-column"');
    expect(printable).toContain('className="print-revenue-column print-revenue-secondary-column"');
    expect(block).toContain(".print-revenue-column { display: grid;");
    expect(block).toContain("align-content: start;");
  });

  it("žebříček odběratelů nepřeteče z karty a jména v tabulkách mají velikost tabulky", () => {
    const block = lastPrintBlock(minimal());
    // Implicitní sloupec gridu se roztáhl podle nezalomitelného jména prvního
    // odběratele, takže pruhy i procenta vyjely za pravý okraj karty.
    expect(block).toMatch(/\.print-ranking-list \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(block).toMatch(/\.print-ranking-list strong \{[^}]*white-space: nowrap/);
    // <strong> v buňce zdědil obrazovkových 13 px: jména dlužníků a názvy
    // výpisů byly dvakrát větší než čísla vedle nich a lámaly se uprostřed slova.
    expect(block).toMatch(/\.print-report-table td strong \{[^}]*font-size: inherit/);
  });

  it("počty faktur na tisku skloňuje (1 faktura, 2 faktury, 5 faktur)", () => {
    const source = printDocument();
    // Průměrná doba úhrady je desetinné číslo; bez formátování vyšlo "14.3 dní".
    expect(source).not.toContain("{report.dso.avg_days} dní");
    expect(source).toContain('import { invoiceCountLabel } from "@/lib/czech-plural"');
    expect(source).not.toMatch(/\} faktur[` ]/);
    expect(source).not.toContain('=== 1 ? "faktura" : "faktur"');
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
