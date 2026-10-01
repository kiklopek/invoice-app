import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const page = () => read("src/app/(workspace)/invoices/import/page.tsx");
const form = () => read("src/components/invoice-form.tsx");
const preview = () => read("src/components/document-preview.tsx");
const css = () => read("src/app/minimal.css");

describe("import faktury: údaje vlevo, náhled dokladu vpravo", () => {
  it("rozdělí obrazovku jen u dokumentu s OCR a zachová formulář", () => {
    const source = page();
    expect(source).toContain("invoice-import-split");
    expect(source).toContain("<DocumentPreview");
    expect(source).toContain("file={active.file}");
    // beze změny: kotva a id, na které se váží styly a odkaz „Vyplnit ručně“
    expect(source).toContain('<div id="manual-invoice-form">');
    expect(source).toContain('href="#manual-invoice-form"');
    expect(source).toContain("onSubmit={create}");
    expect(source).toContain("onActiveFieldChange=");
  });

  it("drží aktivní pole ve stránce a nuluje ho při přepnutí dokumentu", () => {
    const source = page();
    expect(source).toContain("const [activeField, setActiveField]");
    expect(source).toMatch(/setActiveField\(null\)/);
  });

  it("na úzké obrazovce nabízí přepínač Údaje / Doklad a cestu zpět", () => {
    const source = page();
    expect(source).toContain('role="tablist"');
    expect(source).toContain('aria-label="Údaje nebo doklad"');
    expect(source).toContain(">Údaje<");
    expect(source).toContain(">Doklad<");
    expect(source).toContain("Zpět k údajům");
  });

  it("CSS: dva sloupce 1:1, široký workspace jen v režimu rozdělení, lepivý náhled", () => {
    const styles = css();
    expect(styles).toContain(".invoice-import-split {");
    expect(styles).toMatch(/\.invoice-import-split\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
    expect(styles).toMatch(/\.invoice-import-workspace\.is-split\s*\{[^}]*1600px/);
    expect(styles).toMatch(/\.invoice-import-preview-column\s*\{[^}]*position:\s*sticky/);
    expect(styles).toContain(".invoice-import-workspace { width: min(100%, 1120px);");
    expect(styles).toContain(".document-preview-highlight");
  });
});

describe("InvoiceForm: háček na aktivní pole", () => {
  it("volá onActiveFieldChange z fokusu, najetí myší a z kandidátů", () => {
    const source = form();
    expect(source).toContain("onActiveFieldChange?:");
    expect(source).toContain("onFocusCapture");
    expect(source).toContain("onMouseEnter");
    expect(source).toContain("Ukázat v dokladu");
    expect(source).toMatch(/onActiveFieldChange\?\.\(fieldName, candidateFor/);
  });
  it("bez propu nepřidává tlačítko ani obsluhu (ruční zadání faktury)", () => {
    const source = form();
    expect(source).toMatch(/onActiveFieldChange\s*\?\s*\{/);
  });
});

describe("DocumentPreview: CSP-safe vykreslení a poctivé zvýraznění", () => {
  it("vykresluje PDF přes pdf.js bez eval a z vlastního originu", () => {
    const source = preview();
    expect(source).toContain('"use client"');
    // pdfjs-dist 6 volbu isEvalSupported odstranil; žádný eval v kódu komponenty
    expect(source).not.toMatch(/eval\(|new Function/);
    expect(source).toContain('import("pdfjs-dist/build/pdf.mjs")');
    expect(source).toContain('workerSrc = "/pdfjs/pdf.worker.min.mjs"');
    expect(source).toContain("/pdfjs/cmaps/");
    expect(source).toContain("/pdfjs/standard_fonts/");
    expect(source).not.toMatch(/https?:\/\/(?!www\.w3)/);
  });
  it("obrázek jde přes blob URL, který se uvolňuje", () => {
    const source = preview();
    expect(source).toContain("URL.createObjectURL(file)");
    expect(source).toContain("URL.revokeObjectURL(");
  });
  it("nezvýrazňuje odhad a při chybě nabídne stažení", () => {
    const source = preview();
    expect(source).toContain("Místo v dokladu se nepodařilo dohledat");
    expect(source).toContain("Stáhnout dokument");
    expect(source).toContain("locateValueInLayout");
  });
});
