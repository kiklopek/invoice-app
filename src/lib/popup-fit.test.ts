import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fitPopup, POPUP_MARGIN } from "./popup-fit";

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height });
const phone = { width: 390, height: 844 };

// Otevírací okna (menu pod třemi tečkami, nápovědy, našeptávače) se nesmí
// otevřít mimo obrazovku: posunou se dovnitř a když se nevejdou dolů,
// otevřou se nahoru.
describe("okno se vejde do obrazovky", () => {
  it("které se vejde, se nehýbe", () => {
    expect(fitPopup({ popup: rect(100, 100, 200, 150), anchor: rect(100, 60, 40, 40), viewport: phone })).toEqual({ shiftX: 0, placement: null });
  });

  it("přesahující vpravo se posune doleva", () => {
    const fit = fitPopup({ popup: rect(300, 100, 270, 150), anchor: rect(330, 60, 44, 44), viewport: phone });
    expect(fit.shiftX).toBe(390 - POPUP_MARGIN - 570);
    expect(300 + fit.shiftX + 270).toBeLessThanOrEqual(390 - POPUP_MARGIN);
  });

  it("přesahující vlevo se posune doprava", () => {
    expect(fitPopup({ popup: rect(-50, 100, 270, 150), anchor: rect(10, 60, 44, 44), viewport: phone }).shiftX).toBe(POPUP_MARGIN + 50);
  });

  it("širší než obrazovka začne u levého okraje", () => {
    expect(fitPopup({ popup: rect(40, 100, 500, 150), anchor: rect(40, 60, 44, 44), viewport: phone }).shiftX).toBe(POPUP_MARGIN - 40);
  });

  it("u spodního okraje se otevře nahoru, když je nahoře místo", () => {
    expect(fitPopup({ popup: rect(100, 760, 200, 220), anchor: rect(100, 710, 44, 44), viewport: phone }).placement).toBe("above");
  });

  it("nahoru se neotočí, když se nevejde ani tam", () => {
    expect(fitPopup({ popup: rect(100, 120, 200, 760), anchor: rect(100, 70, 44, 44), viewport: phone }).placement).toBe(null);
  });
});

describe("všechna otevírací okna jsou hlídaná", () => {
  const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("okna jsou označená a aplikace je hlídá", () => {
    const detail = source("src/app/(workspace)/invoices/[id]/invoice-detail-client.tsx");
    expect(detail).toMatch(/className="invoice-actions-menu-popover" data-popup/);
    const form = source("src/components/invoice-form.tsx");
    const note = source("src/components/ocr-source-note.tsx");
    expect(note).toMatch(/className="ocr-field-tooltip"[^>]*data-popup/);
    expect(note).toMatch(/data-popup-anchor/);
    expect(form).toMatch(/className="customer-search-results"[^>]*data-popup/);
    expect(source("src/components/layout/app-shell.tsx")).toContain("<PopupFitter />");
  });

  it("menu pod třemi tečkami se na mobilu neotvírá doprava od tlačítka u pravého okraje", () => {
    expect(source("src/app/minimal.css")).not.toContain(".invoice-actions-menu-popover { right: auto; left: 0; }");
  });

  it("nastavení grafu a další kontextové nabídky používají společnou ochranu okrajů", () => {
    expect(source("src/app/(workspace)/dashboard/dashboard-widgets.tsx")).toMatch(/<div data-popup>\s*<label>\s*Měna grafu/);
    expect(source("src/app/(workspace)/dashboard/dashboard-client.tsx")).toMatch(/<div data-popup>\s*<Link href=\{`\/invoices\/\$\{id\}`\}/);
    expect(source("src/app/(workspace)/invoices/invoices-client.tsx")).toMatch(/<div data-popup>\s*\{canManage/);
    expect(source("src/app/(workspace)/reports/reports-client.tsx")).toContain("<FinancialReportExport");
    expect(source("src/components/financial-report/financial-report-export.tsx")).toContain("<Modal");
    expect(source("src/app/(workspace)/invoices/import/ocr-document-picker.tsx")).toMatch(/className=\{styles.pickerPanel\} data-popup/);
    expect(source("src/app/(workspace)/predplatne/subscription-client.tsx")).toMatch(/aria-label="Možnosti předplatného"[^\n]*<div data-popup>/);
  });
});
