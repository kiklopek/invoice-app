import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = () => readFileSync(join(process.cwd(), "src/components/invoice-form.tsx"), "utf8");
const styles = () => readFileSync(join(process.cwd(), "src/app/minimal.css"), "utf8");

describe("faktura z dokumentu -- pole 'již uhrazené zálohy'", () => {
  it("nezobrazí pole na každém importu z dokumentu, jen když je co řešit", () => {
    // Bug: `(!editing && Boolean(form.file_url))` otevíralo celý
    // invoice-money-review blok na KAŽDÉ nové faktuře založené z dokumentu,
    // i když OCR (lokální i AI) nenašlo žádnou zálohu -- initial_paid zůstal
    // 0 a přesto se ukázalo needitovatelné "Zbývá k úhradě: 0.00 CZK".
    const code = source();
    expect(code).toContain("{(needsAmountReview || detectedPrepayment) && <div className=\"wide invoice-money-review\">");
    expect(code).not.toContain("(!editing && Boolean(form.file_url))");
  });

  it("pole pro zálohy se řídí stejnou podmínkou (detectedPrepayment), ne přítomností souboru", () => {
    const code = source();
    expect(code).toContain("{!editing && detectedPrepayment && <>");
    expect(code).not.toContain("{!editing && Boolean(form.file_url) && <>");
  });
});

describe("OCR stav polí", () => {
  it("zobrazuje zelená potvrzení jako kompaktní oznámení", () => {
    const css = styles();
    expect(css).toContain(".import-step-note.ocr-complete {");
    expect(css).toContain("width: fit-content;");
    expect(css).toContain("min-height: 34px;");
    expect(css).toContain("padding: 7px 10px;");
    expect(css).toContain(".import-step-note.ocr-complete > div { display: flex; flex-wrap: wrap;");
  });

  it("neskládá duplicitní stav dokumentu a dlouhý seznam kontrol nad formulář", () => {
    const code = source();
    const css = styles();
    expect(code).toContain("form.file_url && !hasOcrReview");
    expect(code).toContain('<details className="ocr-warnings">');
    expect(code).toContain("údaje vyžadují kontrolu");
    expect(code).toContain("Zobrazit podrobnosti");
    expect(css).toContain(".ocr-warnings:not([open]) { width: fit-content;");
  });

  it("zobrazuje stav pod polem místo absolutně vedle popisku", () => {
    const css = styles();
    expect(css).toContain(".ocr-field-meta { position: relative;");
    expect(css).toContain("margin: 8px 0 0 !important;");
    expect(css).toContain("padding: 0; border: 0; background: transparent;");
    expect(css).toContain('.ocr-field-status::before { content: "";');
    expect(css).toContain(".ocr-field-tooltip { position: absolute;");
    expect(css).toContain("left: 0;");
    expect(css).not.toContain(".ocr-field-meta { position: absolute;");
  });

  it("drží OCR stav vlevo a textovou nápovědu hned vedle něj pod inputem", () => {
    const css = styles();
    expect(css).toContain("label:has(> .ocr-field-meta) { display: grid;");
    expect(css).toContain("grid-template-columns: auto minmax(0,1fr);");
    expect(css).toContain("label:has(> small):has(> .ocr-field-meta) > small { grid-column: 2; grid-row: 3;");
    expect(css).toContain("label:has(> small):has(> .ocr-field-meta) > .ocr-field-meta { grid-column: 1; grid-row: 3;");
  });

  it("zvedá otevřenou OCR nápovědu nad sousední pole a sekce", () => {
    const css = styles();
    expect(css).toContain(".form-section:has(.ocr-field-meta:hover)");
    expect(css).toContain(".form-grid > label:has(.ocr-field-meta:hover)");
    expect(css).toContain(".ocr-field-tooltip { position: absolute; z-index: 120;");
    expect(css).toContain("#manual-invoice-form .standalone-form,#manual-invoice-form .form-section,#manual-invoice-form .form-grid { overflow: visible; }");
  });
});
