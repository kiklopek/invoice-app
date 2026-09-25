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
  it("nabízí tlačítko tisku, které nejede nad nehotovým reportem", () => {
    expect(report()).toContain('disabled={loading || !report} onClick={() => window.print()}');
    expect(report()).toContain('title="Vytisknout nebo uložit jako PDF"');
    expect(report()).toContain("Tisk / PDF");
  });

  it("tiskne hlavičku s firmou, obdobím a aktivními filtry", () => {
    const client = report();
    const printable = printDocument();
    expect(client).toContain("<ReportPrintDocument");
    expect(client).toContain("profile?.companyName");
    expect(client).toContain("dateBasisNames[dateBasis]");
    expect(client).toContain("selectedStatus={selectedStatus}");
    expect(client).toContain("selectedCustomer={selectedCustomer}");
    expect(printable).toContain('className="print-report-cover"');
    expect(printable).toContain('className="print-report-meta"');
    expect(printable).toContain("const footer = `${companyName} · ${period}`;");
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
    const source = report();
    const block = lastPrintBlock(minimal());
    expect(source.match(/report-table-card/g) ?? []).toHaveLength(2);
    expect(source).toContain("report-splittable-card report-imports-card");
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

describe("pracovní plocha reportů", () => {
  it("omezuje žebříček největších odběratelů na pět položek", () => {
    const source = report();
    expect(source).toContain("const TOP_CUSTOMERS_LIMIT = 5");
    expect(source).toContain("customer_concentration.slice(0, TOP_CUSTOMERS_LIMIT)");
    expect(source).toContain("topCustomers.map((row)");
  });

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

  it("odděluje stáří pohledávek od rychlosti úhrad a graf používá až pro trend", () => {
    const source = report();
    const css = minimal();
    expect(source).toContain('report-span-7 report-aging-overview-card');
    expect(source).toContain('report-span-5 report-dso-card report-dso-insight-card');
    expect(source).toContain('className="report-aging-segments"');
    expect(source).toContain('className="report-aging-legend"');
    expect(source).toContain('className="report-dso-line-chart"');
    expect(source).toContain('dsoPoints.length === 1 ? <div className="report-dso-summary">');
    expect(source).toContain('Plně uhrazené faktury');
    expect(source).toContain('<polyline points={dsoPoints.map');
    expect(source).toContain('className="report-dso-point"');
    expect(css).toContain('.report-aging-distribution{padding:20px 18px 16px}');
    expect(css).toContain('.report-aging-legend{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))');
    expect(css).toContain('.report-dso-line-chart{display:flex;min-height:220px;flex:1 1 auto');
    expect(css).toContain('.report-dso-summary{display:grid;min-height:220px;flex:1 1 auto');
    expect(css).toContain('.report-dso-plot polyline{fill:none;stroke:var(--green)');
    expect(css).toContain('.report-aging-overview-card,.report-dso-insight-card{grid-column:1/-1}');
  });

  it("zpřehledňuje tabulku dlužníků pořadím a zvýrazněním rizika", () => {
    const source = report();
    const css = minimal();
    expect(source).toContain('report.debtors.map((row, index)');
    expect(source).toContain('className="report-debtor-name"');
    expect(source).toContain('className={row.overdue ? "report-overdue-amount" : undefined}');
    expect(css).toContain('.report-debtor-name>i{display:grid;width:24px;height:24px');
    expect(css).toContain('.report-overdue-amount{display:inline-flex');
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
