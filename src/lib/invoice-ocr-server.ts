import "server-only";

import { access, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import { definePDFJSModule, getDocumentProxy, renderPageAsImage } from "unpdf";
import { normalizeOcrText, type OcrDocumentLayout, type OcrLayoutLine } from "./invoice-ocr";

export const MAX_TEXT_PDF_PAGES = 30;
export const MAX_SCANNED_PDF_PAGES = 8;
export const OCR_TIMEOUT_MS = 50_000;
const MIN_TEXT_LAYER_CHARACTERS = 40;
const MAX_INPUT_PIXELS = 50_000_000;
const MIN_ENHANCED_PASS_TIME_MS = 12_000;

export class LocalOcrError extends Error {
  constructor(public readonly code: "timeout" | "pdf_too_long" | "scan_too_long" | "invalid_document" | "recognition_failed", message: string) {
    super(message);
    this.name = "LocalOcrError";
  }
}

export type ExtractedDocumentText = {
  text: string;
  ocrUsed: boolean;
  totalPages: number;
  pagesProcessed: number;
  averageConfidence: number | null;
  warnings: string[];
  layout: OcrDocumentLayout;
};

function assertDeadline(deadline: number) {
  if (Date.now() >= deadline) throw new LocalOcrError("timeout", "OCR trvalo příliš dlouho. Zkuste dokument znovu nebo údaje doplňte ručně.");
}

async function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  assertDeadline(deadline);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new LocalOcrError("timeout", "OCR trvalo příliš dlouho. Zkuste dokument znovu nebo údaje doplňte ručně.")), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function preprocessImage(bytes: Uint8Array) {
  const input = sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS });
  const metadata = await input.metadata();
  const sourceWidth = metadata.width ?? 1800;
  const enlargement = Math.max(1, Math.min(3, 2200 / sourceWidth));
  const targetWidth = Math.min(2600, Math.round(sourceWidth * enlargement));

  const normalized = await sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: targetWidth,
      height: 3600,
      fit: "inside",
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 3 })
    .toBuffer();

  const standard = await sharp(normalized, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1 })
    .extend({ top: 18, bottom: 18, left: 18, right: 18, background: "#ffffff" })
    .png({ compressionLevel: 6 })
    .toBuffer();
  const standardMetadata = await sharp(standard).metadata();

  return {
    standard: new Uint8Array(standard),
    width: standardMetadata.width ?? targetWidth,
    height: standardMetadata.height ?? 3600,
    enhanced: async () => new Uint8Array(await sharp(normalized, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
      .grayscale()
      .clahe({ width: 4, height: 4, maxSlope: 3 })
      .sharpen({ sigma: 1.2 })
      .threshold(180)
      .extend({ top: 24, bottom: 24, left: 24, right: 24, background: "#ffffff" })
      .png({ compressionLevel: 6 })
      .toBuffer()),
  };
}

function textQuality(text: string, confidence: number) {
  const normalized = normalizeOcrText(text);
  const characterScore = Math.min(20, normalized.replace(/\s/g, "").length / 25);
  const anchors = [
    /faktura|invoice/i,
    /dodavatel|supplier/i,
    /odb[ěe]ratel|customer|bill\s+to/i,
    /datum|date/i,
    /celkem|total/i,
    /dph|vat/i,
    /(?:i[čc]o|ico|vat\s+id)\s*[:.]?/i,
  ].filter(pattern => pattern.test(normalized)).length;
  return Math.max(0, Math.min(100, confidence * 0.65 + characterScore + anchors * 3));
}

function needsEnhancedPass(text: string, confidence: number) {
  const compactLength = normalizeOcrText(text).replace(/\s/g, "").length;
  const anchorCount = [/faktura|invoice/i, /datum|date/i, /celkem|total/i, /dph|vat/i]
    .filter(pattern => pattern.test(text)).length;
  return confidence < 80 || compactLength < 180 || anchorCount < 3;
}

type PdfTextItem = { str: string; transform: number[]; width?: number; height?: number };

function unionBounds(blocks: OcrLayoutLine["blocks"]) {
  if (!blocks.length) return null;
  const left = Math.min(...blocks.map(block => block.x));
  const top = Math.min(...blocks.map(block => block.y));
  const right = Math.max(...blocks.map(block => block.x + block.width));
  const bottom = Math.max(...blocks.map(block => block.y + block.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function layoutPdfPage(items: PdfTextItem[], page: number, pageWidth: number, pageHeight: number) {
  const safeWidth = Math.max(1, pageWidth);
  const safeHeight = Math.max(1, pageHeight);
  const positioned = items
    .filter(item => item.str.trim() && item.transform.length >= 6)
    .map(item => ({
      text: item.str.trim(),
      x: item.transform[4],
      y: item.transform[5],
      width: Math.max(1, item.width ?? item.str.length * Math.max(4, Math.abs(item.transform[0] ?? 8) * 0.5)),
      height: Math.max(1, item.height ?? Math.abs(item.transform[3] ?? 10)),
    }))
    .sort((left, right) => Math.abs(right.y - left.y) <= 4 ? left.x - right.x : right.y - left.y);
  const grouped: Array<{ y: number; items: typeof positioned }> = [];

  for (const item of positioned) {
    const line = grouped.find(candidate => Math.abs(candidate.y - item.y) <= 4);
    if (line) {
      line.items.push(item);
      line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length;
    } else {
      grouped.push({ y: item.y, items: [item] });
    }
  }

  const lines = grouped.sort((left, right) => right.y - left.y).map((line, index): OcrLayoutLine => {
    const blocks = line.items.sort((left, right) => left.x - right.x).map(item => ({
      text: item.text,
      confidence: null,
      x: item.x / safeWidth,
      y: Math.max(0, (safeHeight - item.y - item.height) / safeHeight),
      width: Math.min(1, item.width / safeWidth),
      height: Math.min(1, item.height / safeHeight),
    }));
    return {
      page,
      line: index + 1,
      text: normalizeOcrText(blocks.map(block => block.text).join(" ")),
      source: "pdf_text",
      confidence: null,
      bounds: unionBounds(blocks),
      blocks,
    };
  });
  return { page, width: pageWidth, height: pageHeight, text: normalizeOcrText(lines.map(line => line.text).join("\n")), lines };
}

export function layoutPdfTextItems(items: PdfTextItem[]) {
  return layoutPdfPage(items, 1, 1000, 1000).text;
}

async function extractPdfPagesWithLayout(pdf: Awaited<ReturnType<typeof getDocumentProxy>>, deadline: number) {
  const pages: ReturnType<typeof layoutPdfPage>[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    assertDeadline(deadline);
    const page = await withDeadline(pdf.getPage(pageNumber), deadline);
    const content = await withDeadline(page.getTextContent(), deadline);
    const viewport = page.getViewport({ scale: 1 });
    const items: PdfTextItem[] = content.items.flatMap(item => "str" in item && "transform" in item
      ? [{ str: item.str, transform: Array.from(item.transform), width: item.width, height: item.height }]
      : []);
    pages.push(layoutPdfPage(items, pageNumber, viewport.width, viewport.height));
  }
  return pages;
}

function layoutOcrPage(
  data: Awaited<ReturnType<Worker["recognize"]>>["data"],
  page: number,
  width: number,
  height: number,
  startLine = 1,
  crop?: { left: number; top: number; fullWidth: number; fullHeight: number },
) {
  const fullWidth = Math.max(1, crop?.fullWidth ?? width);
  const fullHeight = Math.max(1, crop?.fullHeight ?? height);
  const leftOffset = crop?.left ?? 0;
  const topOffset = crop?.top ?? 0;
  const recognizedLines = data.blocks?.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines)) ?? [];
  const sourceLines = recognizedLines.length
    ? recognizedLines.map(line => ({ text: line.text, confidence: line.confidence, bbox: line.bbox, words: line.words }))
    : normalizeOcrText(data.text).split("\n").filter(Boolean).map((text, index) => ({
        text,
        confidence: data.confidence,
        bbox: { x0: 0, y0: index * 20, x1: width, y1: (index + 1) * 20 },
        words: [],
      }));

  return sourceLines.map((line, index): OcrLayoutLine => {
    const blocks = line.words.length ? line.words.map(word => ({
      text: word.text,
      confidence: word.confidence,
      x: (leftOffset + word.bbox.x0) / fullWidth,
      y: (topOffset + word.bbox.y0) / fullHeight,
      width: (word.bbox.x1 - word.bbox.x0) / fullWidth,
      height: (word.bbox.y1 - word.bbox.y0) / fullHeight,
    })) : [{
      text: normalizeOcrText(line.text),
      confidence: line.confidence,
      x: (leftOffset + line.bbox.x0) / fullWidth,
      y: (topOffset + line.bbox.y0) / fullHeight,
      width: (line.bbox.x1 - line.bbox.x0) / fullWidth,
      height: (line.bbox.y1 - line.bbox.y0) / fullHeight,
    }];
    return {
      page,
      line: startLine + index,
      text: normalizeOcrText(line.text),
      source: "ocr",
      confidence: line.confidence,
      bounds: unionBounds(blocks),
      blocks,
    };
  });
}

async function createLocalWorker() {
  const languageDirectory = await mkdtemp(join(tmpdir(), "invoice-ocr-"));
  try {
    const nodeModulesDirectory = join(process.cwd(), "node_modules");
    await Promise.all([
      access(join(nodeModulesDirectory, "bmp-js", "index.js")),
      access(join(nodeModulesDirectory, "is-url", "index.js")),
      access(join(nodeModulesDirectory, "regenerator-runtime", "runtime.js")),
      access(join(nodeModulesDirectory, "tesseract.js-core", "package.json")),
      access(join(nodeModulesDirectory, "wasm-feature-detect", "dist", "cjs", "index.cjs")),
    ]);
    await Promise.all([
      copyFile(join(nodeModulesDirectory, "@tesseract.js-data", "ces", "4.0.0", "ces.traineddata.gz"), join(languageDirectory, "ces.traineddata.gz")),
      copyFile(join(nodeModulesDirectory, "@tesseract.js-data", "eng", "4.0.0", "eng.traineddata.gz"), join(languageDirectory, "eng.traineddata.gz")),
    ]);
    const worker = await createWorker(["ces", "eng"], OEM.LSTM_ONLY, {
      cacheMethod: "none",
      gzip: true,
      langPath: languageDirectory,
      workerPath: join(nodeModulesDirectory, "tesseract.js", "src", "worker-script", "node", "index.js"),
    });
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: "1",
      user_defined_dpi: "220",
    });
    return { worker, languageDirectory };
  } catch (cause) {
    await rm(languageDirectory, { recursive: true, force: true });
    throw cause;
  }
}

async function recognizeImages(images: Uint8Array[], deadline: number, includeCounterpartyDetail = false, pageNumbers = images.map((_, index) => index + 1)) {
  let worker: Worker | null = null;
  let languageDirectory: string | null = null;
  const texts: string[] = [];
  const confidences: number[] = [];
  const layoutPages: OcrDocumentLayout["pages"] = [];
  let enhancedPasses = 0;
  try {
    const localWorker = await createLocalWorker();
    worker = localWorker.worker;
    languageDirectory = localWorker.languageDirectory;
    assertDeadline(deadline);
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const image = images[imageIndex];
      const pageNumber = pageNumbers[imageIndex] ?? imageIndex + 1;
      assertDeadline(deadline);
      const preprocessed = await withDeadline(preprocessImage(image), deadline);
      let result = await withDeadline(worker.recognize(Buffer.from(preprocessed.standard), { rotateAuto: true }, { text: true, blocks: true }), deadline);
      let confidence = Number.isFinite(result.data.confidence) ? result.data.confidence : 0;

      if (needsEnhancedPass(result.data.text, confidence) && deadline - Date.now() >= MIN_ENHANCED_PASS_TIME_MS) {
        const enhanced = await withDeadline(preprocessed.enhanced(), deadline);
        await withDeadline(worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }), deadline);
        const enhancedResult = await withDeadline(worker.recognize(Buffer.from(enhanced), { rotateAuto: true }, { text: true, blocks: true }), deadline);
        await withDeadline(worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO }), deadline);
        const enhancedConfidence = Number.isFinite(enhancedResult.data.confidence) ? enhancedResult.data.confidence : 0;
        if (textQuality(enhancedResult.data.text, enhancedConfidence) > textQuality(result.data.text, confidence)) {
          result = enhancedResult;
          confidence = enhancedConfidence;
          enhancedPasses += 1;
        }
      }

      texts.push(result.data.text);
      if (Number.isFinite(confidence)) confidences.push(confidence);
      const pageLines = layoutOcrPage(result.data, pageNumber, preprocessed.width, preprocessed.height);
      layoutPages.push({ page: pageNumber, width: preprocessed.width, height: preprocessed.height, lines: pageLines });

      if (includeCounterpartyDetail && images.length === 1) {
        const metadata = await withDeadline(sharp(preprocessed.standard).metadata(), deadline);
        const width = metadata.width ?? 0;
        const height = metadata.height ?? 0;
        if (width >= 600 && height >= 600 && deadline - Date.now() >= MIN_ENHANCED_PASS_TIME_MS) {
          const left = Math.floor(width * 0.42);
          const detail = await withDeadline(sharp(preprocessed.standard)
            .extract({ left, top: 0, width: width - left, height: Math.floor(height * 0.62) })
            .extend({ top: 24, bottom: 24, left: 24, right: 24, background: "#ffffff" })
            .png({ compressionLevel: 6 })
            .toBuffer(), deadline);
          const detailResult = await withDeadline(worker.recognize(detail, { rotateAuto: false }, { text: true, blocks: true }), deadline);
          texts.push(`ODBĚRATEL DETAIL\n${detailResult.data.text}`);
          if (Number.isFinite(detailResult.data.confidence)) confidences.push(detailResult.data.confidence);
          pageLines.push(...layoutOcrPage(detailResult.data, pageNumber, width - left + 48, Math.floor(height * 0.62) + 48, pageLines.length + 1, {
            left: Math.max(0, left - 24),
            top: 0,
            fullWidth: width,
            fullHeight: height,
          }));
        }
      }
    }
  } catch (cause) {
    if (cause instanceof LocalOcrError) throw cause;
    throw new LocalOcrError("recognition_failed", cause instanceof Error ? cause.message : "Lokální OCR dokument nezpracovalo.");
  } finally {
    if (worker) await worker.terminate().catch(() => undefined);
    if (languageDirectory) await rm(languageDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
  return {
    text: normalizeOcrText(texts.join("\n\n")),
    pages: texts.map(normalizeOcrText),
    confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null,
    enhancedPasses,
    layout: { pages: layoutPages },
  };
}

async function extractPdf(bytes: Uint8Array, deadline: number): Promise<ExtractedDocumentText> {
  try {
    await withDeadline(definePDFJSModule(async () => {
      const [pdfjs, pdfjsWorker] = await Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs"),
        import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
      ]);
      Object.assign(globalThis, { pdfjsWorker });
      return pdfjs;
    }), deadline);
    const pdf = await withDeadline(getDocumentProxy(bytes), deadline);
    try {
      if (pdf.numPages > MAX_TEXT_PDF_PAGES) {
        throw new LocalOcrError("pdf_too_long", `PDF má ${pdf.numPages} stran. Podporováno je nejvýše ${MAX_TEXT_PDF_PAGES} stran.`);
      }
      const pages = await extractPdfPagesWithLayout(pdf, deadline);
      const pagesForOcr = pages.filter(item => item.text.replace(/\s/g, "").length < MIN_TEXT_LAYER_CHARACTERS);
      if (!pagesForOcr.length) {
        return { text: pages.map(page => page.text).join("\n\n"), ocrUsed: false, totalPages: pdf.numPages, pagesProcessed: pdf.numPages, averageConfidence: null, warnings: [], layout: { pages: pages.map(({ page, width, height, lines }) => ({ page, width, height, lines })) } };
      }
      if (pagesForOcr.length > MAX_SCANNED_PDF_PAGES) {
        throw new LocalOcrError("scan_too_long", `Skenované PDF má ${pagesForOcr.length} stran bez čitelné textové vrstvy. OCR podporuje nejvýše ${MAX_SCANNED_PDF_PAGES} takových stran.`);
      }
      const rendered: Uint8Array[] = [];
      for (const item of pagesForOcr) {
        assertDeadline(deadline);
        const image = await withDeadline(renderPageAsImage(pdf, item.page, {
          canvasImport: () => import("@napi-rs/canvas"),
          scale: 2,
        }), deadline);
        rendered.push(new Uint8Array(image));
      }
      const recognized = await recognizeImages(rendered, deadline, false, pagesForOcr.map(page => page.page));
      let recognizedIndex = 0;
      const merged = pages.map(page => page.text.replace(/\s/g, "").length >= MIN_TEXT_LAYER_CHARACTERS ? page.text : recognized.pages[recognizedIndex++] ?? "");
      const recognizedLayouts = new Map(recognized.layout.pages.map(page => [page.page, page]));
      return {
        text: normalizeOcrText(merged.join("\n\n")),
        ocrUsed: true,
        totalPages: pdf.numPages,
        pagesProcessed: pagesForOcr.length,
        averageConfidence: recognized.confidence,
        warnings: [
          ...(pagesForOcr.length < pdf.numPages ? ["Část PDF byla přečtena z textové vrstvy a část pomocí OCR."] : []),
          ...(recognized.enhancedPasses ? ["U hůře čitelné části dokumentu bylo použito zesílené OCR."] : []),
        ],
        layout: { pages: pages.map(({ page, width, height, lines }) => recognizedLayouts.get(page) ?? { page, width, height, lines }) },
      };
    } finally {
      const disposable = pdf as unknown as { destroy?: () => Promise<void>; cleanup?: () => Promise<void> | void };
      if (typeof disposable.destroy === "function") await disposable.destroy();
      else if (typeof disposable.cleanup === "function") await disposable.cleanup();
    }
  } catch (cause) {
    if (cause instanceof LocalOcrError) throw cause;
    throw new LocalOcrError("invalid_document", cause instanceof Error ? cause.message : "PDF se nepodařilo otevřít.");
  }
}

export async function extractInvoiceDocumentText({ bytes, mime, timeoutMs = OCR_TIMEOUT_MS }: {
  bytes: Uint8Array;
  mime: string;
  timeoutMs?: number;
}): Promise<ExtractedDocumentText> {
  const deadline = Date.now() + timeoutMs;
  if (mime === "application/pdf") return extractPdf(bytes, deadline);
  try {
    const recognized = await recognizeImages([bytes], deadline, true);
    return {
      text: recognized.text,
      ocrUsed: true,
      totalPages: 1,
      pagesProcessed: 1,
      averageConfidence: recognized.confidence,
      warnings: recognized.enhancedPasses ? ["Fotografie vyžadovala zesílené OCR. Zkontrolujte předvyplněné údaje."] : [],
      layout: recognized.layout,
    };
  } catch (cause) {
    if (cause instanceof LocalOcrError) throw cause;
    throw new LocalOcrError("invalid_document", "Obrázek se nepodařilo otevřít nebo rozpoznat.");
  }
}
