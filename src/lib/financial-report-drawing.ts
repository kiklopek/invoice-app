import "server-only";
import {
  PDFDocument,
  rgb,
  type PDFPage,
  type PDFFont,
  type RGB,
  type PDFImage,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FinancialReportModel } from "./financial-report";
import { REPORT_MODES } from "./financial-report";
import { formatCzechDate } from "./display-date";
import { invoiceLogoBytes } from "./invoice-logo-server";
export class ReportLimitError extends Error {}
const palette = {
  ink: rgb(0.09, 0.16, 0.13),
  muted: rgb(0.32, 0.42, 0.36),
  green: rgb(0.08, 0.34, 0.22),
  mint: rgb(0.53, 0.72, 0.61),
  soft: rgb(0.94, 0.97, 0.95),
  line: rgb(0.87, 0.91, 0.89),
  amber: rgb(0.76, 0.48, 0.1),
  red: rgb(0.69, 0.23, 0.23),
  white: rgb(1, 1, 1),
};
export const REPORT_COLORS = palette;
let fontBytes: { regular: Uint8Array; bold: Uint8Array } | undefined;
let boldFace: ReturnType<typeof fontkit.create> | undefined;
export type ReportColumn = { label: string; weight: number; right?: boolean };
export class ReportDrawing {
  page!: PDFPage;
  y = 0;
  width: number;
  height: number;
  readonly margin = 45;
  readonly bottom: number;
  readonly contentWidth: number;
  private title = "";
  private subtitle = "";
  private constructor(
    readonly pdf: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    readonly logo: PDFImage,
    readonly model: FinancialReportModel,
  ) {
    [this.width, this.height] =
      model.options.orientation === "landscape"
        ? [841.89, 595.28]
        : [595.28, 841.89];
    this.contentWidth = this.width - 90;
    this.bottom = this.height - 58;
  }
  static async create(model: FinancialReportModel) {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    fontBytes ??= {
      regular: new Uint8Array(
        readFileSync(
          join(process.cwd(), "assets/fonts/LiberationSans-Regular.ttf"),
        ),
      ),
      bold: new Uint8Array(
        readFileSync(
          join(process.cwd(), "assets/fonts/LiberationSans-Bold.ttf"),
        ),
      ),
    };
    const [regular, bold, logo] = await Promise.all([
      pdf.embedFont(fontBytes.regular, { subset: true }),
      pdf.embedFont(fontBytes.bold, { subset: true }),
      invoiceLogoBytes().then((bytes) => pdf.embedPng(bytes)),
    ]);
    pdf.setTitle(
      `${REPORT_MODES[model.options.mode]} · ${model.snapshot.company.name}`,
    );
    pdf.setAuthor(model.snapshot.company.name);
    pdf.setCreator("Splatno");
    pdf.setCreationDate(new Date(model.snapshot.generated_at));
    pdf.setModificationDate(new Date(model.snapshot.generated_at));
    return new ReportDrawing(pdf, regular, bold, logo, model);
  }
  wrap(value: string, width: number, size = 9, font = this.regular) {
    const result: string[] = [];
    for (const paragraph of String(value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .split("\n")) {
      let line = "";
      for (const ch of paragraph) {
        if (line && font.widthOfTextAtSize(line + ch, size) > width) {
          const space = line.lastIndexOf(" ");
          if (space > line.length * 0.4) {
            result.push(line.slice(0, space));
            line = line.slice(space + 1);
          } else {
            result.push(line);
            line = "";
          }
        }
        line += ch;
      }
      result.push(line);
    }
    return result;
  }
  text(
    value: string,
    x: number,
    top: number,
    {
      size = 9,
      strong = false,
      color = palette.ink,
      width = this.contentWidth,
      right = false,
    }: {
      size?: number;
      strong?: boolean;
      color?: RGB;
      width?: number;
      right?: boolean;
    } = {},
  ) {
    const font = strong ? this.bold : this.regular,
      lines = this.wrap(value, width, size, font);
    lines.forEach((line, i) =>
      this.page.drawText(line, {
        x: right ? x - font.widthOfTextAtSize(line, size) : x,
        y: this.height - top - size - i * size * 1.35,
        size,
        font,
        color,
      }),
    );
    return lines.length * size * 1.35;
  }
  rect(
    x: number,
    top: number,
    width: number,
    height: number,
    color = palette.soft,
    border = false,
  ) {
    this.page.drawRectangle({
      x,
      y: this.height - top - height,
      width,
      height,
      color,
      ...(border ? { borderColor: palette.line, borderWidth: 0.6 } : {}),
    });
  }
  rule(top = this.y) {
    this.page.drawLine({
      start: { x: this.margin, y: this.height - top },
      end: { x: this.width - this.margin, y: this.height - top },
      color: palette.line,
      thickness: 0.6,
    });
  }
  newPage(title: string, subtitle = "") {
    if (this.pdf.getPageCount() >= 750)
      throw new ReportLimitError(
        "Sestava přesahuje 750 stran. Zúžte období nebo obsah reportu.",
      );
    this.title = title.replace(/(?: · pokračování)+$/, "");
    this.subtitle = subtitle;
    this.page = this.pdf.addPage([this.width, this.height]);
    this.rect(0, 0, this.width, this.height, palette.white);
    const scale = 23 / this.logo.height;
    this.page.drawImage(this.logo, {
      x: this.margin,
      y: this.height - 45 - 23,
      width: this.logo.width * scale,
      height: 23,
    });
    this.text("splatno", this.margin + 23, 44, { size: 15, strong: true });
    const company = this.model.snapshot.company;
    let top = 43;
    top += this.text(company.name, this.width - this.margin, top, {
      size: 8,
      strong: true,
      right: true,
      width: this.contentWidth * 0.54,
    });
    this.text(
      [company.ico && `IČO ${company.ico}`, company.dic && `DIČ ${company.dic}`]
        .filter(Boolean)
        .join(" · "),
      this.width - this.margin,
      top + 2,
      {
        size: 7.5,
        right: true,
        width: this.contentWidth * 0.54,
        color: palette.muted,
      },
    );
    this.y = Math.max(84, top + 25);
    this.y += this.text(title, this.margin, this.y, { size: 18, strong: true });
    const period = `${formatCzechDate(this.model.query.from)} – ${formatCzechDate(this.model.query.to)}`;
    this.y +=
      this.text(
        subtitle || `${period} · ${this.model.query.currency}`,
        this.margin,
        this.y + 4,
        { size: 8.5, color: palette.muted },
      ) + 17;
    this.rule(this.y - 6);
  }
  ensure(height: number) {
    if (height > this.bottom - 135)
      throw new ReportLimitError(
        "Jeden blok je pro A4 příliš dlouhý. Zvolte širší orientaci nebo užší výběr.",
      );
    if (this.y + height > this.bottom)
      this.newPage(this.title + " · pokračování", this.subtitle);
  }
  heading(value: string) {
    this.ensure(34);
    this.y +=
      this.text(value, this.margin, this.y, { size: 12, strong: true }) + 10;
  }
  paragraph(value: string) {
    const lines = this.wrap(value, this.contentWidth, 9);
    for (const line of lines) {
      this.ensure(15);
      this.text(line, this.margin, this.y, { size: 9, color: palette.muted });
      this.y += 13;
    }
    this.y += 9;
  }
  note(value: string) {
    const lines = this.wrap(value, this.contentWidth - 24, 8.5);
    const h = lines.length * 11.475 + 22;
    this.ensure(h);
    this.rect(this.margin, this.y, this.contentWidth, h, palette.soft, true);
    this.text(value, this.margin + 12, this.y + 11, {
      size: 8.5,
      width: this.contentWidth - 24,
      color: palette.muted,
    });
    this.y += h + 15;
  }
  kpis(items: { label: string; value: string; note?: string }[]) {
    const gap = 12,
      w = (this.contentWidth - gap) / 2;
    for (let i = 0; i < items.length; i += 2) {
      const pair = items.slice(i, i + 2);
      const heights = pair.map(
        (item) =>
          26 +
          this.wrap(item.value, w - 24, 18, this.bold).length * 24.3 +
          (item.note ? this.wrap(item.note, w - 24, 8).length * 10.8 : 0) +
          12,
      );
      const h = Math.max(82, ...heights);
      this.ensure(h);
      pair.forEach((item, j) => {
        const x = this.margin + j * (w + gap);
        this.rect(x, this.y, w, h, palette.soft, true);
        this.text(item.label, x + 12, this.y + 10, {
          size: 8.5,
          color: palette.muted,
          width: w - 24,
        });
        const valueH = this.text(item.value, x + 12, this.y + 27, {
          size: 18,
          strong: true,
          color: palette.green,
          width: w - 24,
        });
        if (item.note)
          this.text(item.note, x + 12, this.y + 29 + valueH, {
            size: 8,
            color: palette.muted,
            width: w - 24,
          });
      });
      this.y += h + 12;
    }
    this.y += 4;
  }
  table(
    columns: ReportColumn[],
    rows: string[][],
    { total = false }: { total?: boolean } = {},
  ) {
    if (!rows.length) {
      this.note("Ve zvoleném výběru nejsou žádné záznamy.");
      return;
    }
    const totalWeight = columns.reduce((s, c) => s + c.weight, 0),
      widths = columns.map((c) => (this.contentWidth * c.weight) / totalWeight);
    const header = () => {
      this.ensure(54);
      const h =
        Math.max(
          ...columns.map(
            (c, i) => this.wrap(c.label, widths[i] - 12, 8, this.bold).length,
          ),
        ) *
          10.8 +
        16;
      this.rect(this.margin, this.y, this.contentWidth, h, palette.soft);
      let x = this.margin;
      columns.forEach((c, i) => {
        this.text(c.label, c.right ? x + widths[i] - 6 : x + 6, this.y + 8, {
          size: 8,
          strong: true,
          color: palette.muted,
          width: widths[i] - 12,
          right: c.right,
        });
        x += widths[i];
      });
      this.y += h;
    };
    header();
    rows.forEach((row, index) => {
      const strong = total && index === rows.length - 1;
      const h =
        Math.max(
          ...row.map(
            (cell, i) =>
              this.wrap(
                cell,
                widths[i] - 12,
                8.5,
                strong ? this.bold : this.regular,
              ).length,
          ),
        ) *
          11.475 +
        14;
      if (h > this.bottom - 180)
        throw new ReportLimitError(
          "Příliš dlouhý řádek tabulky. Zvolte A4 na šířku.",
        );
      if (this.y + h > this.bottom) {
        this.newPage(this.title + " · pokračování", this.subtitle);
        header();
      }
      if (strong)
        this.rect(this.margin, this.y, this.contentWidth, h, palette.soft);
      let x = this.margin;
      row.forEach((cell, i) => {
        this.text(
          cell,
          columns[i].right ? x + widths[i] - 6 : x + 6,
          this.y + 7,
          {
            size: 8.5,
            strong,
            width: widths[i] - 12,
            right: columns[i].right,
            color: strong ? palette.green : palette.ink,
          },
        );
        x += widths[i];
      });
      this.y += h;
      this.rule();
    });
    this.y += 18;
  }
  bars(
    title: string,
    data: { label: string; values: number[] }[],
    series: string[],
    currency?: string,
  ) {
    if (!data.length) {
      this.heading(title);
      this.note("Pro graf nejsou ve výběru dostupná data.");
      return;
    }
    for (let chunk = 0; chunk < data.length; chunk += 12) {
      const rows = data.slice(chunk, chunk + 12);
      this.ensure(225);
      this.heading(title + (chunk ? " · pokračování" : ""));
      const top = this.y,
        chartH = 125,
        labelH = 25,
        left = this.margin + 44,
        w = this.contentWidth - 44;
      const values = rows.flatMap((d) => d.values),
        min = Math.min(0, ...values),
        max = Math.max(1, ...values),
        range = max - min,
        py = (v: number) => top + chartH - ((v - min) / range) * chartH;
      for (let i = 0; i < 4; i++) {
        const value = min + (range * i) / 3,
          y = py(value);
        this.page.drawLine({
          start: { x: left, y: this.height - y },
          end: { x: left + w, y: this.height - y },
          color: palette.line,
          thickness: 0.5,
        });
        this.text(
          new Intl.NumberFormat("cs-CZ", {
            notation: currency ? "compact" : "standard",
            maximumFractionDigits: 1,
          }).format(value),
          left - 7,
          y - 4,
          { size: 7, right: true, width: 38, color: palette.muted },
        );
      }
      const groupW = w / rows.length,
        barW = Math.min(16, groupW / (series.length + 2));
      rows.forEach((row, i) => {
        row.values.forEach((v, j) => {
          const x =
            left + i * groupW + groupW / 2 + (j - series.length / 2) * barW;
          const y = py(v),
            zero = py(0);
          this.rect(
            x,
            Math.min(y, zero),
            barW - 2,
            Math.max(0.5, Math.abs(zero - y)),
            j === 0 ? palette.green : palette.mint,
          );
        });
        this.text(row.label, left + (i + 0.5) * groupW, top + chartH + 7, {
          size: 7,
          right: true,
          width: groupW - 2,
          color: palette.muted,
        });
      });
      this.y = top + chartH + labelH + 9;
      series.forEach((label, i) => {
        this.rect(
          this.margin + i * 200,
          this.y + 2,
          7,
          7,
          i === 0 ? palette.green : palette.mint,
        );
        this.text(label, this.margin + 12 + i * 200, this.y, {
          size: 8,
          width: 185,
          color: palette.muted,
        });
      });
      this.y += 25;
      if (currency) {
        this.text(
          `Hodnoty v ${currency}; přesné částky jsou v souhrnu a tabulkách.`,
          this.margin,
          this.y,
          { size: 7.5, color: palette.muted },
        );
        this.y += 18;
      }
    }
  }
  donut(
    title: string,
    data: { label: string; value: number; detail?: string }[],
    center: string,
  ) {
    if (data.some((d) => d.value < 0)) {
      this.heading(title);
      this.note(
        "Podíl není vykreslen pro záporné hodnoty. Přesné hodnoty obsahuje tabulka.",
      );
      return;
    }
    const total = data.reduce((sum, row) => sum + row.value, 0);
    if (!total) {
      this.heading(title);
      this.note("Bez hodnot pro zobrazení podílu.");
      return;
    }
    const legend = data.map((row) => {
      const text = `${row.label}: ${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format((row.value / total) * 100)} %${row.detail ? ` · ${row.detail}` : ""}`;
      return {
        text,
        height: this.wrap(text, this.contentWidth - 167, 9).length * 12.15,
      };
    });
    const legendHeight =
      legend.reduce((sum, row) => sum + row.height, 0) +
      Math.max(0, legend.length - 1) * 11;
    const chartHeight = Math.max(134, legendHeight);
    const headingHeight =
      this.wrap(title, this.contentWidth, 12, this.bold).length * 16.2 + 10;
    this.ensure(headingHeight + chartHeight + 14);
    this.heading(title);
    const top = this.y,
      cx = this.margin + 66,
      cy = top + chartHeight / 2,
      r = 58,
      colors = [palette.green, palette.amber, palette.mint, palette.red];
    let start = -Math.PI / 2;
    data.forEach((row, i) => {
      if (!row.value) return;
      const angle = (row.value / total) * Math.PI * 2,
        end = start + angle;
      if (angle >= Math.PI * 2 - 0.00001) {
        this.page.drawCircle({
          x: cx,
          y: this.height - cy,
          size: r,
          color: colors[i % 4],
        });
      } else {
        const sx = Math.cos(start) * r,
          sy = Math.sin(start) * r,
          ex = Math.cos(end) * r,
          ey = Math.sin(end) * r;
        this.page.drawSvgPath(
          `M 0 0 L ${sx} ${sy} A ${r} ${r} 0 ${angle > Math.PI ? 1 : 0} 1 ${ex} ${ey} Z`,
          { x: cx, y: this.height - cy, color: colors[i % 4] },
        );
      }
      start = end;
    });
    this.page.drawCircle({
      x: cx,
      y: this.height - cy,
      size: 40,
      color: palette.white,
    });
    let centerSize = /^[\d\s.,]+$/u.test(center) ? 24 : 18;
    while (
      centerSize > 8 &&
      this.bold.widthOfTextAtSize(center, centerSize) > 64
    )
      centerSize--;
    const centerLines = this.wrap(center, 64, centerSize, this.bold);
    const face = (boldFace ??= fontkit.create(fontBytes!.bold));
    centerLines.forEach((text, index) => {
      if (!text.trim()) return;
      const run = face.layout(text);
      const glyphs = run.glyphs
        .map((glyph, i) => ({
          box: glyph.bbox,
          offset: run.positions[i].yOffset,
        }))
        .filter(({ box }) => box.maxY > box.minY);
      const minY = Math.min(
        ...glyphs.map(({ box, offset }) => box.minY + offset),
      );
      const maxY = Math.max(
        ...glyphs.map(({ box, offset }) => box.maxY + offset),
      );
      const baseline =
        this.height -
        cy +
        ((centerLines.length - 1) / 2 - index) * centerSize * 1.25 -
        (((minY + maxY) / 2) * centerSize) / face.unitsPerEm;
      this.page.drawText(text, {
        x: cx - this.bold.widthOfTextAtSize(text, centerSize) / 2,
        y: baseline,
        size: centerSize,
        font: this.bold,
        color: palette.ink,
      });
    });
    let cursor = top + (chartHeight - legendHeight) / 2;
    legend.forEach((row, i) => {
      this.rect(this.margin + 153, cursor + 3, 7, 7, colors[i % 4]);
      cursor +=
        this.text(row.text, this.margin + 167, cursor, {
          size: 9,
          width: this.contentWidth - 167,
        }) + 11;
    });
    this.y = top + chartHeight + 14;
  }
  horizontal(
    rows: { label: string; amount: string; value: number; note: string }[],
  ) {
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
    for (const row of rows) {
      const h = Math.max(
        50,
        this.wrap(row.label, this.contentWidth * 0.5, 9).length * 12 + 30,
      );
      this.ensure(h);
      this.text(row.label, this.margin, this.y, {
        size: 9,
        strong: true,
        width: this.contentWidth * 0.5,
      });
      this.text(row.amount, this.width - this.margin, this.y, {
        size: 10,
        strong: true,
        right: true,
        width: this.contentWidth * 0.45,
      });
      this.text(row.note, this.margin, this.y + 17, {
        size: 8,
        color: palette.muted,
      });
      this.rect(
        this.margin,
        this.y + h - 10,
        this.contentWidth,
        3,
        palette.line,
      );
      if (row.value)
        this.rect(
          this.margin,
          this.y + h - 10,
          (this.contentWidth * Math.abs(row.value)) / max,
          3,
          palette.green,
        );
      this.y += h + 8;
    }
    this.y += 8;
  }
  async finish() {
    const pages = this.pdf.getPages(),
      generated = new Intl.DateTimeFormat("cs-CZ", {
        timeZone: "Europe/Prague",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(this.model.snapshot.generated_at));
    pages.forEach((page, i) => {
      this.page = page;
      this.rule(this.height - 42);
      this.text(
        "splatno.cz · Vygenerováno systémem Splatno",
        this.margin,
        this.height - 31,
        { size: 7, color: palette.muted, width: this.contentWidth * 0.6 },
      );
      this.text(
        `Strana ${i + 1} z ${pages.length}`,
        this.width - this.margin,
        this.height - 31,
        { size: 7, color: palette.muted, right: true, width: 120 },
      );
    });
    this.pdf.setSubject(
      `${REPORT_MODES[this.model.options.mode]} · ${generated} Europe/Prague`,
    );
    return { bytes: await this.pdf.save(), pageCount: pages.length };
  }
}
