import ExcelJS from "exceljs";

export type ExcelColumn = {
  header: string;
  key: string;
  width?: number;
  numberFormat?: string;
};

type ExcelValue = string | number | Date | null | undefined;

export async function createExcelWorkbook(
  sheetName: string,
  columns: ExcelColumn[],
  rows: Record<string, ExcelValue>[],
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Splatno";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });

  sheet.columns = columns.map(column => ({
    header: column.header,
    key: column.key,
    width: column.width ?? 14,
    style: column.numberFormat ? { numFmt: column.numberFormat } : undefined,
  }));
  sheet.addRows(rows);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  const header = sheet.getRow(1);
  header.height = 28;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF28583B" } };
  header.alignment = { vertical: "middle", horizontal: "left", wrapText: false };

  sheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "middle", wrapText: false };
    if (rowNumber > 1 && rowNumber % 2 === 1) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F7F4" } };
    }
    row.eachCell(cell => {
      cell.border = { bottom: { style: "thin", color: { argb: "FFDCE4DE" } } };
    });
  });

  // Keep columns readable without allowing exceptionally long values to make the sheet unwieldy.
  columns.forEach((column, index) => {
    if (column.width) return;
    let longest = column.header.length;
    for (const row of rows) longest = Math.max(longest, String(row[column.key] ?? "").length);
    sheet.getColumn(index + 1).width = Math.min(45, Math.max(11, longest + 2));
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

export function excelDate(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)) : null;
}

export function excelResponse(bytes: Uint8Array, filename: string) {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body, { headers: {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": `attachment; filename=${filename}`,
    "cache-control": "private, no-store",
  } });
}
