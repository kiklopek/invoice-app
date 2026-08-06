export function csvCell(value: unknown) {
  let content = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(content)) content = `'${content}`;
  return `"${content.replaceAll('"', '""')}"`;
}

export function createCsv(rows: unknown[][]) {
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(";")).join("\r\n");
}

