import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getDocumentProxy, extractText } from "unpdf";
import { financialReportFixture } from "@/test/financial-report-fixtures";
import {
  createReportMoney,
  parseReportOptions,
  DEFAULT_REPORT_OPTIONS,
} from "./financial-report";
import { generateFinancialReport } from "./financial-report-pdf";
import { exactMoney } from "./money-display";
describe("financial PDF reports", () => {
  it("formats SQL decimal strings without losing cents in very large or negative sums", () => {
    const money = createReportMoney("CZK");
    expect(money("900719925474099.93").replace(/\s/g, " ")).toBe(
      "900 719 925 474 099,93 Kč",
    );
    expect(money("-900719925474099.91").replace(/\s/g, " ")).toBe(
      "−900 719 925 474 099,91 Kč",
    );
    expect(money("0")).toBe("0,00 Kč");
  });
  it("validates modes and normalizes summary without detail tables", () => {
    expect(
      parseReportOptions({ ...DEFAULT_REPORT_OPTIONS, mode: "summary" }),
    ).toMatchObject({ details: false, customers: false });
    expect(() =>
      parseReportOptions({ ...DEFAULT_REPORT_OPTIONS, sections: [] }),
    ).toThrow();
    expect(() =>
      parseReportOptions({ ...DEFAULT_REPORT_OPTIONS, sections: ["other"] }),
    ).toThrow();
    expect(() =>
      parseReportOptions({ ...DEFAULT_REPORT_OPTIONS, mode: "toString" }),
    ).toThrow();
  });
  it("renders all report chapters with real totals, Czech text, numbering and A4", async () => {
    const m = financialReportFixture();
    const { bytes, pageCount } = await generateFinancialReport(m);
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    expect(pageCount).toBeGreaterThanOrEqual(12);
    expect(pageCount).toBeLessThan(17);
    expect(text).toContain("Metodika a rozsah reportu");
    expect(text).toContain("Rozdělení posouzení");
    expect(text).toContain("Tento report není daňovým přiznáním");
    expect(text).toContain("Odběratel 1 s.r.o.");
    expect(text.replace(/\s/g, " ")).toContain(
      exactMoney(m.snapshot.report.total, "CZK").replace(/\s/g, " "),
    );
    expect(text).toContain(`Strana ${pageCount} z ${pageCount}`);
    const page = await pdf.getPage(1);
    expect(page.getViewport({ scale: 1 }).width).toBeCloseTo(595.28, 1);
  });
  it("summary keeps key values without the invoice register", async () => {
    const m = financialReportFixture();
    m.options = parseReportOptions({ ...m.options, mode: "summary" });
    const { bytes, pageCount } = await generateFinancialReport(m);
    const { text } = await extractText(await getDocumentProxy(bytes), {
      mergePages: true,
    });
    expect(pageCount).toBeGreaterThanOrEqual(m.options.sections.length);
    expect(text).not.toContain("FV-2026-00001");
    expect(text).toContain("Evidované úhrady");
  });
  it.each(["summary", "detailed", "complete", "custom"] as const)(
    "starts every chapter on its own page in %s mode",
    async (mode) => {
      const model = financialReportFixture();
      model.options = parseReportOptions({ ...model.options, mode });
      const { bytes } = await generateFinancialReport(model);
      const pdf = await getDocumentProxy(bytes);
      const titles = [
        "Přehled tržeb",
        "Přehled DPH",
        "Přehled pohledávek",
        mode === "summary" ? "Bankovní přehled" : "Přehled plateb",
      ];
      if (mode !== "summary")
        titles.push(
          "Největší odběratelé",
          "Detailní přehled faktur",
          "Detailní přehled DPH",
          "Analýza pohledávek",
          "Rozdělení posouzení",
          "Detail zaúčtovaných výpisů",
          "Metodika a rozsah reportu",
        );
      if (mode === "complete" || mode === "custom")
        titles.push("Finanční report", "Souhrn reportu");
      const found = new Map<string, number>();
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number),
          content = await page.getTextContent();
        for (const item of content.items) {
          if (
            !("str" in item) ||
            !titles.includes(item.str) ||
            Math.abs(item.transform[0] - 18) > 0.1
          )
            continue;
          expect(found.has(item.str)).toBe(false);
          expect(item.transform[5]).toBeGreaterThan(
            page.getViewport({ scale: 1 }).height - 120,
          );
          found.set(item.str, number);
        }
      }
      expect([...found.keys()].sort()).toEqual([...titles].sort());
      expect(new Set(found.values()).size).toBe(titles.length);
    },
  );
  it("supports a payments-only summary without creating an empty invoice chapter", async () => {
    const model = financialReportFixture();
    model.options = parseReportOptions({
      ...model.options,
      mode: "summary",
      sections: ["payments"],
    });
    const { bytes } = await generateFinancialReport(model);
    const { text } = await extractText(await getDocumentProxy(bytes), {
      mergePages: true,
    });
    expect(text).toContain("Bankovní přehled");
    expect(text).not.toContain("Přehled tržeb");
  });
  it("paginates hundreds of invoice rows without losing the final record or header", async () => {
    const m = financialReportFixture(300);
    m.options = {
      ...m.options,
      mode: "custom",
      sections: ["revenue"],
      charts: false,
      customers: false,
    };
    const { bytes, pageCount } = await generateFinancialReport(m);
    expect(pageCount).toBeGreaterThan(8);
    const { text } = await extractText(await getDocumentProxy(bytes), {
      mergePages: true,
    });
    expect(text).toContain("FV-2026-00300");
    expect(text.match(/Vystavení/g)!.length).toBeGreaterThan(3);
  });
  it("keeps an empty selection concise and checks every actual footer", async () => {
    const m = financialReportFixture(0);
    const { bytes, pageCount } = await generateFinancialReport(m);
    expect(pageCount).toBeLessThanOrEqual(2);
    const pdf = await getDocumentProxy(bytes),
      { text } = await extractText(pdf, { mergePages: true });
    expect(text).toContain("bez záznamů");
    expect(text).not.toContain("Největší odběratelé");
  });
  it("custom selection and landscape preserve scope", async () => {
    const m = financialReportFixture();
    m.options = {
      ...m.options,
      mode: "custom",
      sections: ["payments"],
      orientation: "landscape",
    };
    const { bytes } = await generateFinancialReport(m);
    const pdf = await getDocumentProxy(bytes),
      { text } = await extractText(pdf, { mergePages: true });
    expect(text).not.toContain("Detailní přehled faktur");
    expect(text).toContain("celá firma, všechny měny");
    expect((await pdf.getPage(1)).getViewport({ scale: 1 }).width).toBeCloseTo(
      841.89,
      1,
    );
  });
  it("keeps long customer tables complete and all text inside real page margins", async () => {
    const m = financialReportFixture(80);
    m.options = {
      ...m.options,
      mode: "custom",
      sections: ["revenue"],
      details: false,
      charts: false,
    };
    m.snapshot.company.name =
      "Velmi dlouhý název společnosti pro mezinárodní obchod a poradenství s.r.o.";
    m.snapshot.customers = m.snapshot.invoices.map((row, i) => ({
      name: `Firma ${String(i).padStart(3, "0")} · ${"Dlouhý název společnosti ".repeat(7)}`,
      invoiced: row.amount,
      paid: row.paid_amount,
      count: 1,
    }));
    const { bytes, pageCount } = await generateFinancialReport(m),
      pdf = await getDocumentProxy(bytes);
    expect(pageCount).toBeGreaterThan(4);
    const { text } = await extractText(pdf, { mergePages: true });
    expect(text).toContain("Firma 079");
    for (let n = 1; n <= pageCount; n++) {
      const page = await pdf.getPage(n),
        viewport = page.getViewport({ scale: 1 }),
        content = await page.getTextContent();
      expect(
        content.items.some(
          (item) => "str" in item && item.str === `Strana ${n} z ${pageCount}`,
        ),
      ).toBe(true);
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        expect(item.transform[4]).toBeGreaterThanOrEqual(43);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(
          viewport.width - 43,
        );
        expect(item.transform[5]).toBeGreaterThanOrEqual(18);
        expect(item.transform[5] + item.height).toBeLessThan(
          viewport.height - 30,
        );
      }
    }
  });
});
