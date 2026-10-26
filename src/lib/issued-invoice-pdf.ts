import "server-only";
import {
  PDFDocument,
  PrintScaling,
  rgb,
  type PDFFont,
  type RGB,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import {
  publicInvoiceDocument,
  creationUnitPrice,
  type IssuedInvoiceDocument,
} from "./invoice-creation";
import { exactMoney } from "./money-display";
import { formatCzechDate } from "./display-date";
import { buildSpayd } from "./czech-payment";
import { invoiceLogoBytes } from "./invoice-logo-server";

let fonts: { regular: Uint8Array; bold: Uint8Array } | null = null;
export async function generateIssuedInvoicePdf(
  snapshot: IssuedInvoiceDocument,
) {
  const model = publicInvoiceDocument(snapshot);
  const pdf = await PDFDocument.create();
  // A4 already includes safe printer margins; request actual-size printing.
  pdf.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  pdf.registerFontkit(fontkit);
  fonts ??= {
    regular: new Uint8Array(
      readFileSync(
        join(process.cwd(), "assets/fonts/LiberationSans-Regular.ttf"),
      ),
    ),
    bold: new Uint8Array(
      readFileSync(join(process.cwd(), "assets/fonts/LiberationSans-Bold.ttf")),
    ),
  };
  const regular = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });
  const ink = rgb(0.09, 0.17, 0.13),
    muted = rgb(0.32, 0.42, 0.36),
    green = rgb(0.1, 0.36, 0.23),
    line = rgb(0.88, 0.92, 0.89),
    soft = rgb(0.95, 0.97, 0.95);
  const left = 42,
    right = 553,
    width = right - left;
  let page = pdf.addPage([595.28, 841.89]),
    y = 794;
  pdf.setTitle(`Faktura ${model.invoice_number}`);
  // Measure before drawing, including long identifiers and precise unit prices.
  function wrap(
    value: string,
    maxWidth: number,
    size = 10,
    font: PDFFont = regular,
  ) {
    const lines: string[] = [];
    for (const paragraph of value
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .split("\n")) {
      let current = "";
      for (const character of paragraph) {
        if (
          current &&
          font.widthOfTextAtSize(current + character, size) > maxWidth
        ) {
          lines.push(current);
          current = "";
        }
        current += character;
      }
      lines.push(current);
    }
    return lines;
  }
  function draw(
    lines: string[],
    x: number,
    top: number,
    size = 10,
    strong = false,
    color: RGB = ink,
    alignRight = false,
  ) {
    const font = strong ? bold : regular;
    lines.forEach((value, i) =>
      page.drawText(value, {
        x: alignRight ? x - font.widthOfTextAtSize(value, size) : x,
        y: top - size - i * size * 1.45,
        size,
        font,
        color,
      }),
    );
    return top - lines.length * size * 1.45;
  }
  function block(
    value: string,
    x: number,
    top: number,
    maxWidth: number,
    size = 10,
    strong = false,
    color: RGB = ink,
    alignRight = false,
  ) {
    return draw(
      wrap(value, maxWidth, size, strong ? bold : regular),
      x,
      top,
      size,
      strong,
      color,
      alignRight,
    );
  }
  function rule(top: number) {
    page.drawLine({
      start: { x: left, y: top },
      end: { x: right, y: top },
      thickness: 0.6,
      color: line,
    });
  }
  function nextPage() {
    page = pdf.addPage([595.28, 841.89]);
    y = 794;
    y =
      block(
        `Faktura ${model.invoice_number} · pokračování`,
        left,
        y,
        width,
        10,
        true,
        green,
      ) - 12;
    rule(y);
    y -= 18;
  }
  function ensure(height: number) {
    if (y - height < 48) nextPage();
  }
  page.drawRectangle({ x: left, y: 800, width, height: 3, color: green });
  block(
    model.supplier.vat_payer ? "DAŇOVÝ DOKLAD" : "FAKTURA NEPLÁTCE DPH",
    left,
    782,
    330,
    9,
    false,
    muted,
  );
  const brand = await pdf.embedPng(
    await invoiceLogoBytes(model.supplier.logo_path),
  );
  const brandScale = Math.min(76 / brand.width, 48 / brand.height);
  page.drawImage(brand, {
    x: right - brand.width * brandScale,
    y: 735,
    width: brand.width * brandScale,
    height: brand.height * brandScale,
  });
  const titleBottom = block(model.supplier.name, left, 758, 400, 23, true);
  y =
    block(
      `Faktura č. ${model.invoice_number}`,
      left,
      titleBottom - 7,
      400,
      12,
      false,
      muted,
    ) - 20;
  if (/^KONCEPT/.test(model.invoice_number))
    block("KONCEPT", right, 726, 100, 9, true, green, true);
  const dates = [
    ["Vystaveno", model.issue_date],
    ...(model.supplier.vat_payer ? [["DUZP", model.tax_date]] : []),
    ["Splatnost", model.due_date],
  ];
  rule(y);
  y -= 12;
  dates.forEach(([label, value], i) => {
    const x = left + (i * width) / 3;
    block(label, x, y, 150, 8, false, muted);
    block(
      `${label === "DUZP" ? "DUZP: " : ""}${formatCzechDate(value)}`,
      x,
      y - 15,
      155,
      10,
      true,
      label === "Splatnost" ? green : ink,
    );
  });
  y -= 43;
  rule(y);
  y -= 22;
  const partyTop = y;
  const partyBottom = (
    [
      ["Dodavatel", model.supplier],
      ["Odběratel", model.customer],
    ] as const
  ).map(([label, party], i) => {
    const x = left + i * 270;
    let cursor = block(label, x, partyTop, 241, 9, false, muted) - 7;
    cursor = block(party.name, x, cursor, 241, 12, true) - 4;
    cursor = block(party.address, x, cursor, 241, 10) - 5;
    for (const value of [
      party.ico && `IČO: ${party.ico}`,
      party.dic && `DIČ: ${party.dic}`,
      party.email,
    ])
      if (value) cursor = block(value, x, cursor, 241, 9, false, muted);
    return cursor;
  });
  y = Math.min(...partyBottom) - 24;
  const columns = [
    { x: left, width: 211, right: false },
    { x: 316, width: 57, right: true },
    { x: 430, width: 104, right: true },
    { x: right, width: 113, right: true },
  ];
  function tableHeader() {
    page.drawRectangle({ x: left, y: y - 29, width, height: 29, color: soft });
    [
      "Položka",
      "Množství",
      model.supplier.vat_payer ? "Cena/MJ bez DPH" : "Cena/MJ",
      model.supplier.vat_payer ? "Celkem s DPH" : "Celkem",
    ].forEach((value, i) =>
      block(
        value,
        columns[i].x + (i === 0 ? 8 : 0),
        y - 9,
        columns[i].width,
        8,
        false,
        muted,
        columns[i].right,
      ),
    );
    y -= 39;
  }
  const rows = model.totals.lines.map((item) => {
    const cells = [
      wrap(item.description, columns[0].width, 10, bold),
      wrap(`${item.quantity} ${item.unit}`, columns[1].width, 9),
      wrap(
        creationUnitPrice(item.unit_price, model.currency),
        columns[2].width,
        9,
      ),
      wrap(exactMoney(item.gross, model.currency), columns[3].width, 10, bold),
    ];
    const meta = [
      model.supplier.vat_payer ? `DPH ${item.vat_rate} %` : "",
      Number(item.discount.replace(",", ".")) ? `Sleva ${item.discount} %` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const metaLines = meta ? wrap(meta, columns[0].width, 8) : [];
    const rowHeight =
      Math.max(
        cells[0].length * 14.5 + metaLines.length * 11.6 + 5,
        cells[1].length * 13.05,
        cells[2].length * 13.05,
        cells[3].length * 14.5,
      ) + 18;
    return { cells, metaLines, rowHeight };
  });
  // Reserve the complete first row, including its repeated table header.
  // Long descriptions must not leave an orphaned header on the preceding page.
  ensure(39 + (rows[0]?.rowHeight ?? 0));
  tableHeader();
  for (const { cells, metaLines, rowHeight } of rows) {
    if (y - rowHeight < 48) {
      nextPage();
      tableHeader();
    }
    cells.forEach((lines, i) =>
      draw(
        lines,
        columns[i].x,
        y,
        i === 1 || i === 2 ? 9 : 10,
        i === 0 || i === 3,
        ink,
        columns[i].right,
      ),
    );
    if (metaLines.length)
      draw(metaLines, left, y - cells[0].length * 14.5 - 4, 8, false, muted);
    y -= rowHeight;
    rule(y + 7);
  }
  y -= 16;
  const moneyRows = model.supplier.vat_payer
    ? [
        ["Celkem bez DPH", exactMoney(model.totals.net, model.currency)],
        ...model.totals.breakdown.map((row) => [
          `DPH ${row.rate} % ze základu ${exactMoney(row.net, model.currency)}`,
          exactMoney(row.tax, model.currency),
        ]),
      ]
    : [];
  const summaryRows = moneyRows.map(([label, value]) => {
    const labelLines = wrap(label, 172, 9),
      valueLines = wrap(value, 126, 10);
    return {
      labelLines,
      valueLines,
      height: Math.max(labelLines.length * 13.05, valueLines.length * 14.5) + 8,
    };
  });
  const amountLines = wrap(
      exactMoney(model.totals.gross, model.currency),
      181,
      17,
      bold,
    ),
    amountHeight = Math.max(48, amountLines.length * 24.65 + 20);
  const qr =
    model.payment_method === "bank" && model.currency === "CZK"
      ? buildSpayd({
          account: model.payment_account,
          amount: model.totals.gross,
          currency: model.currency,
          variableSymbol: model.variable_symbol,
          dueDate: model.due_date,
          message: model.invoice_number,
        })
      : null;
  const paymentLines = [
    model.payment_method === "bank" ? "Bankovní převod" : "Hotově",
    ...(model.payment_account ? [`Číslo účtu: ${model.payment_account}`] : []),
    ...(model.variable_symbol
      ? [`Variabilní symbol: ${model.variable_symbol}`]
      : []),
  ];
  const paymentHeight = Math.max(
    qr ? 119 : 86,
    32 +
      paymentLines.reduce(
        (sum, value) => sum + wrap(value, 350, 10).length * 14.5,
        0,
      ),
  );
  // Totals, amount due and QR/payment instructions are one measured closing block.
  ensure(
    summaryRows.reduce((sum, row) => sum + row.height, 0) +
      amountHeight +
      24 +
      paymentHeight +
      18,
  );
  for (const { labelLines, valueLines, height } of summaryRows) {
    draw(labelLines, 236, y, 9, false, muted);
    draw(valueLines, right - 12, y, 10, false, ink, true);
    y -= height;
  }
  page.drawRectangle({
    x: 236,
    y: y - amountHeight,
    width: right - 236,
    height: amountHeight,
    color: rgb(0.91, 0.95, 0.92),
  });
  block("Celkem k úhradě", 248, y - 17, 110, 10, true, green);
  draw(amountLines, right - 12, y - 12, 17, true, green, true);
  y -= amountHeight + 24;
  page.drawRectangle({
    x: left,
    y: y - paymentHeight,
    width,
    height: paymentHeight,
    color: soft,
    borderWidth: 0.6,
    borderColor: line,
  });
  let paymentY =
    block("PLATEBNÍ ÚDAJE", left + 14, y - 13, 350, 8, false, muted) - 8;
  paymentLines.forEach((value, i) => {
    paymentY = block(value, left + 14, paymentY, 350, 10, i === 0);
  });
  if (qr) {
    const image = await pdf.embedPng(
      await QRCode.toBuffer(qr, { margin: 4, width: 512 }),
    );
    page.drawImage(image, { x: right - 100, y: y - 96, width: 82, height: 82 });
    block("QR platba", right - 19, y - 99, 85, 8, false, muted, true);
  }
  y -= paymentHeight + 18;
  if (!model.supplier.vat_payer) {
    ensure(24);
    y =
      block("Dodavatel není plátcem DPH.", left, y, width, 9, false, muted) -
      10;
  }
  if (model.public_note)
    for (const value of wrap(model.public_note, width, 9)) {
      ensure(15);
      y = draw([value], left, y, 9, false, muted);
    }
  const pages = pdf.getPages();
  pages.forEach((sheet, i) => {
    sheet.drawLine({
      start: { x: left, y: 34 },
      end: { x: right, y: 34 },
      color: line,
      thickness: 0.5,
    });
    const numbering = `${i + 1} / ${pages.length}`;
    sheet.drawText(numbering, {
      x: right - regular.widthOfTextAtSize(numbering, 8),
      y: 21,
      size: 8,
      font: regular,
      color: muted,
    });
  });
  return pdf.save();
}
