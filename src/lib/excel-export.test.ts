import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { createExcelWorkbook, excelDate } from "./excel-export";

describe("Excel export", () => {
  it("uses xlsx export on invoice list, archive and reports", () => {
    for (const path of [
      "src/app/(workspace)/invoices/invoices-client.tsx",
      "src/app/(workspace)/invoices/archive/page.tsx",
      "src/app/(workspace)/reports/reports-client.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source, path).toContain('"xlsx"');
      expect(source, path).not.toContain('"csv"');
      expect(source, path).not.toContain("Export CSV");
    }
  });

  it("creates a formatted, filtered sheet with typed values", async () => {
    const bytes = await createExcelWorkbook("Faktury", [
      { header: "Číslo faktury", key: "number", width: 18 },
      { header: "Částka", key: "amount", width: 16, numberFormat: "#,##0.00" },
      { header: "Splatnost", key: "due", width: 14, numberFormat: "dd.mm.yyyy" },
    ], [{ number: "FV-001", amount: 12100.5, due: excelDate("2026-08-15") }]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes.buffer as ArrayBuffer);
    const sheet = workbook.getWorksheet("Faktury")!;
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
    expect(sheet.getRow(1).font.bold).toBe(true);
    expect(sheet.getColumn(1).width).toBe(18);
    expect(sheet.getCell("B2").value).toBe(12100.5);
    expect(sheet.getCell("B2").numFmt).toBe("#,##0.00");
    expect(sheet.getCell("C2").value).toBeInstanceOf(Date);
  });
});
