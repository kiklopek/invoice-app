import "server-only";

import { access, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import { definePDFJSModule, getDocumentProxy, renderPageAsImage } from "unpdf";
import { DAMAGED_TEXT_LAYER_WARNING, normalizeOcrText, type OcrDocumentLayout, type OcrLayoutLine } from "./invoice-ocr";
import { hasDroppedGlyphLabels, repairDroppedGlyphLabels } from "./invoice-ocr-vocabulary";
import { decodeQrCodesFromImage } from "./invoice-qr";

export const MAX_TEXT_PDF_PAGES = 30;
export const MAX_SCANNED_PDF_PAGES = 8;
export const OCR_TIMEOUT_MS = 50_000;
const MIN_TEXT_LAYER_CHARACTERS = 40;
const MAX_INPUT_PIXELS = 50_000_000;
const MIN_ENHANCED_PASS_TIME_MS = 12_000;

export class LocalOcrError extends Error {
  constructor(public readonly code: "timeout" | "pdf_too_long" | "scan_too_long" | "invalid_document" | "recognition_failed" | "empty_ocr_text", message: string) {
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
  // Strojově čitelná faktura vložená do PDF (ISDOC), pokud ji dokument nese.
  isdoc?: { fileName: string; xml: string } | null;
  // Obsah QR kódů nalezených na prvních stránkách / na obrázku.
  qrCodes?: string[];
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

// White margins added around the image so Tesseract sees text away from the
// edge. Boxes must be normalised against the image WITHOUT them -- that is
// the image the browser shows (EXIF rotation applied, like .rotate() here).
const STANDARD_OCR_PAD = 18;
const ENHANCED_OCR_PAD = 24;
const DETAIL_OCR_PAD = 24;

// How pixel coordinates of an image Tesseract read map onto the displayed
// document: normalised = (pixel + offset) / size, offset removing any padding
// and crop origin, size being the unpadded document image.
export type OcrImageFrame = { offsetX: number; offsetY: number; width: number; height: number };

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
    .extend({ top: STANDARD_OCR_PAD, bottom: STANDARD_OCR_PAD, left: STANDARD_OCR_PAD, right: STANDARD_OCR_PAD, background: "#ffffff" })
    .png({ compressionLevel: 6 })
    .toBuffer();
  const [normalizedMetadata, standardMetadata] = await Promise.all([sharp(normalized).metadata(), sharp(standard).metadata()]);
  const width = standardMetadata.width ?? targetWidth + 2 * STANDARD_OCR_PAD;
  const height = standardMetadata.height ?? 3600 + 2 * STANDARD_OCR_PAD;
  const contentWidth = normalizedMetadata.width ?? width - 2 * STANDARD_OCR_PAD;
  const contentHeight = normalizedMetadata.height ?? height - 2 * STANDARD_OCR_PAD;
  const frame = (pad: number): OcrImageFrame => ({ offsetX: -pad, offsetY: -pad, width: contentWidth, height: contentHeight });

  return {
    standard: new Uint8Array(standard),
    width,
    height,
    contentWidth,
    contentHeight,
    standardFrame: frame(STANDARD_OCR_PAD),
    enhancedFrame: frame(ENHANCED_OCR_PAD),
    enhanced: async () => new Uint8Array(await sharp(normalized, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
      .grayscale()
      .clahe({ width: 4, height: 4, maxSlope: 3 })
      .sharpen({ sigma: 1.2 })
      .threshold(180)
      .extend({ top: ENHANCED_OCR_PAD, bottom: ENHANCED_OCR_PAD, left: ENHANCED_OCR_PAD, right: ENHANCED_OCR_PAD, background: "#ffffff" })
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

// Maps a text item into the coordinates of the page AS DISPLAYED (pdfjs
// viewport: /Rotate applied, MediaBox/CropBox origin removed, y downwards).
// Without this, a rotated page or a MediaBox not starting at 0,0 produced
// boxes somewhere else than the text the browser shows.
function viewportBox(item: PdfTextItem, viewportTransform: number[]) {
  const [a, b, c, d, e, f] = item.transform;
  const advanceScale = Math.hypot(a, b);
  const fontScale = Math.hypot(c, d);
  const width = Math.max(1, item.width ?? item.str.length * Math.max(4, (advanceScale || 8) * 0.5));
  const height = Math.max(1, item.height ?? (fontScale || 10));
  // Text run direction and "up" direction in PDF user space.
  const [dirX, dirY] = advanceScale ? [a / advanceScale, b / advanceScale] : [1, 0];
  const [upX, upY] = fontScale ? [c / fontScale, d / fontScale] : [0, 1];
  const [va, vb, vc, vd, ve, vf] = viewportTransform;
  const toViewport = (x: number, y: number) => [va * x + vc * y + ve, vb * x + vd * y + vf] as const;
  const corners = [
    toViewport(e, f),
    toViewport(e + dirX * width, f + dirY * width),
    toViewport(e + upX * height, f + upY * height),
    toViewport(e + dirX * width + upX * height, f + dirY * width + upY * height),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const [baselineX, baselineY] = corners[0];
  return { baselineX, baselineY, left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

// `pageWidth`/`pageHeight` are the viewport (displayed) size and
// `viewportTransform` the pdfjs viewport.transform at the same scale. Without
// a transform the page is taken as unrotated with its origin at 0,0.
export function layoutPdfPage(items: PdfTextItem[], page: number, pageWidth: number, pageHeight: number, viewportTransform?: number[]) {
  const safeWidth = Math.max(1, pageWidth);
  const safeHeight = Math.max(1, pageHeight);
  const transform = viewportTransform && viewportTransform.length >= 6 && viewportTransform.slice(0, 6).every(Number.isFinite)
    ? viewportTransform
    : [1, 0, 0, -1, 0, pageHeight];
  const positioned = items
    .filter(item => item.str.trim() && item.transform.length >= 6)
    .map(item => {
      const box = viewportBox(item, transform);
      // y grows downwards here (viewport), so reading order is ascending y.
      return { text: item.str.trim(), x: box.left, y: box.baselineY, box };
    })
    .sort((left, right) => Math.abs(right.y - left.y) <= 4 ? left.x - right.x : left.y - right.y);
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

  const lines = grouped.sort((left, right) => left.y - right.y).map((line, index): OcrLayoutLine => {
    const blocks = line.items.sort((left, right) => left.x - right.x).map(item => ({
      text: item.text,
      confidence: null,
      x: Math.max(0, item.box.left / safeWidth),
      y: Math.max(0, item.box.top / safeHeight),
      width: Math.min(1, (item.box.right - item.box.left) / safeWidth),
      height: Math.min(1, (item.box.bottom - item.box.top) / safeHeight),
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
    pages.push(layoutPdfPage(items, pageNumber, viewport.width, viewport.height, Array.from(viewport.transform)));
  }
  return pages;
}

type OcrPixelBox = { x0: number; y0: number; x1: number; y1: number };
type OcrRecognizedLine = { text: string; confidence: number; bbox: OcrPixelBox; words: Array<{ text: string; confidence: number; bbox: OcrPixelBox }> };

// Pixel box of the image Tesseract read -> normalised box on the displayed
// document, clipped to the page (padding is blank, nothing real lies there).
function frameBox(bbox: OcrPixelBox, frame: OcrImageFrame) {
  const width = Math.max(1, frame.width);
  const height = Math.max(1, frame.height);
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const left = clamp((bbox.x0 + frame.offsetX) / width);
  const top = clamp((bbox.y0 + frame.offsetY) / height);
  const right = clamp((bbox.x1 + frame.offsetX) / width);
  const bottom = clamp((bbox.y1 + frame.offsetY) / height);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function layoutOcrPage(
  data: { text: string; confidence: number; blocks?: Array<{ paragraphs: Array<{ lines: OcrRecognizedLine[] }> }> | null },
  page: number,
  frame: OcrImageFrame,
  startLine = 1,
) {
  const recognizedLines = data.blocks?.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines)) ?? [];
  // Without Tesseract's line structure the positions below are invented
  // (evenly spaced rows), so such lines get no bounds -- the preview must
  // never highlight a guess. The parser still gets its blocks as before.
  const positionsKnown = recognizedLines.length > 0;
  const sourceLines: OcrRecognizedLine[] = positionsKnown
    ? recognizedLines.map(line => ({ text: line.text, confidence: line.confidence, bbox: line.bbox, words: line.words }))
    : normalizeOcrText(data.text).split("\n").filter(Boolean).map((text, index) => ({
        text,
        confidence: data.confidence,
        bbox: { x0: -frame.offsetX, y0: index * 20 - frame.offsetY, x1: frame.width - frame.offsetX, y1: (index + 1) * 20 - frame.offsetY },
        words: [],
      }));

  return sourceLines.map((line, index): OcrLayoutLine => {
    const blocks = line.words.length ? line.words.map(word => ({
      text: word.text,
      confidence: word.confidence,
      ...frameBox(word.bbox, frame),
    })) : [{
      text: normalizeOcrText(line.text),
      confidence: line.confidence,
      ...frameBox(line.bbox, frame),
    }];
    return {
      page,
      line: startLine + index,
      text: normalizeOcrText(line.text),
      source: "ocr",
      confidence: line.confidence,
      bounds: positionsKnown ? unionBounds(blocks) : null,
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
      let resultFrame = preprocessed.standardFrame;

      if (needsEnhancedPass(result.data.text, confidence) && deadline - Date.now() >= MIN_ENHANCED_PASS_TIME_MS) {
        const enhanced = await withDeadline(preprocessed.enhanced(), deadline);
        await withDeadline(worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }), deadline);
        const enhancedResult = await withDeadline(worker.recognize(Buffer.from(enhanced), { rotateAuto: true }, { text: true, blocks: true }), deadline);
        await withDeadline(worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO }), deadline);
        const enhancedConfidence = Number.isFinite(enhancedResult.data.confidence) ? enhancedResult.data.confidence : 0;
        if (textQuality(enhancedResult.data.text, enhancedConfidence) > textQuality(result.data.text, confidence)) {
          result = enhancedResult;
          confidence = enhancedConfidence;
          resultFrame = preprocessed.enhancedFrame;
          enhancedPasses += 1;
        }
      }

      texts.push(result.data.text);
      if (Number.isFinite(confidence)) confidences.push(confidence);
      const pageLines = layoutOcrPage(result.data, pageNumber, resultFrame);
      layoutPages.push({ page: pageNumber, width: preprocessed.contentWidth, height: preprocessed.contentHeight, lines: pageLines });

      if (includeCounterpartyDetail && images.length === 1) {
        const metadata = await withDeadline(sharp(preprocessed.standard).metadata(), deadline);
        const width = metadata.width ?? 0;
        const height = metadata.height ?? 0;
        if (width >= 600 && height >= 600 && deadline - Date.now() >= MIN_ENHANCED_PASS_TIME_MS) {
          const left = Math.floor(width * 0.42);
          const detail = await withDeadline(sharp(preprocessed.standard)
            .extract({ left, top: 0, width: width - left, height: Math.floor(height * 0.62) })
            .extend({ top: DETAIL_OCR_PAD, bottom: DETAIL_OCR_PAD, left: DETAIL_OCR_PAD, right: DETAIL_OCR_PAD, background: "#ffffff" })
            .png({ compressionLevel: 6 })
            .toBuffer(), deadline);
          const detailResult = await withDeadline(worker.recognize(detail, { rotateAuto: false }, { text: true, blocks: true }), deadline);
          texts.push(`ODBĚRATEL DETAIL\n${detailResult.data.text}`);
          if (Number.isFinite(detailResult.data.confidence)) confidences.push(detailResult.data.confidence);
          // Detail pixel -> padded standard image (crop origin, minus the
          // detail pad) -> document image (minus the standard pad).
          pageLines.push(...layoutOcrPage(detailResult.data, pageNumber, {
            offsetX: left - DETAIL_OCR_PAD - STANDARD_OCR_PAD,
            offsetY: -DETAIL_OCR_PAD - STANDARD_OCR_PAD,
            width: preprocessed.contentWidth,
            height: preprocessed.contentHeight,
          }, pageLines.length + 1));
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

const MAX_QR_PAGES = 2;
const MAX_DAMAGED_OCR_PAGES = 2;
const MAX_ATTACHMENT_BYTES = 2_000_000;
// Textová vrstva PDF nemá vlastní jistotu; znaky, které v ní jsou, jsou
// přesné. Pro porovnání s Tesseractem se proto bere jako vysoce jistá.
const PDF_TEXT_LAYER_CONFIDENCE = 90;

type PdfProxy = Awaited<ReturnType<typeof getDocumentProxy>>;

type PdfAttachment = { filename?: string; content?: Uint8Array | null };
type PdfAttachmentApi = {
  getAttachments: () => Promise<Map<string, PdfAttachment> | Record<string, PdfAttachment> | null>;
  getAttachmentContent?: (id: string) => Promise<Uint8Array | null>;
};

async function readIsdocAttachment(pdf: PdfProxy, deadline: number): Promise<ExtractedDocumentText["isdoc"]> {
  try {
    const api = pdf as unknown as PdfAttachmentApi;
    const attachments = await withDeadline(api.getAttachments(), deadline);
    // pdfjs 6 vrací Map a obsah dotahuje až na vyžádání; starší verze objekt s obsahem.
    const entries = attachments instanceof Map ? [...attachments.entries()] : Object.entries(attachments ?? {});
    for (const [key, attachment] of entries) {
      const fileName = (attachment.filename || key).slice(0, 200);
      if (!/\.(isdoc|xml)$/i.test(fileName)) continue;
      const content = attachment.content
        ?? (typeof api.getAttachmentContent === "function" ? await withDeadline(api.getAttachmentContent(key), deadline) : null);
      if (!content || content.byteLength > MAX_ATTACHMENT_BYTES) continue;
      const xml = new TextDecoder("utf-8").decode(content);
      if (/isdoc\.cz\/namespace/.test(xml)) return { fileName, xml };
    }
  } catch (cause) {
    if (cause instanceof LocalOcrError) throw cause;
    // Poškozené přílohy nejsou důvod dokument odmítnout.
  }
  return null;
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
      const isdoc = await readIsdocAttachment(pdf, deadline);
      const pages = await extractPdfPagesWithLayout(pdf, deadline);
      const pagesForOcr = pages.filter(item => item.text.replace(/\s/g, "").length < MIN_TEXT_LAYER_CHARACTERS);
      if (pagesForOcr.length > MAX_SCANNED_PDF_PAGES) {
        throw new LocalOcrError("scan_too_long", `Skenované PDF má ${pagesForOcr.length} stran bez čitelné textové vrstvy. OCR podporuje nejvýše ${MAX_SCANNED_PDF_PAGES} takových stran.`);
      }
      // Textová vrstva bez č/ď/ě/ň/ř/ť/ů: popisky se dají opravit, hodnoty ne.
      // Zkusí se i Tesseract nad vykreslenou stránkou a vezme se lepší text.
      const damagedPages = pages.filter(item => !pagesForOcr.includes(item) && hasDroppedGlyphLabels(item.text));
      const damagedForOcr = damagedPages.slice(0, MAX_DAMAGED_OCR_PAGES)
        .filter(() => deadline - Date.now() >= MIN_ENHANCED_PASS_TIME_MS);
      const ocrPageNumbers = new Set([...pagesForOcr, ...damagedForOcr].map(page => page.page));
      const renderPageNumbers = [...new Set([...pages.slice(0, MAX_QR_PAGES).map(page => page.page), ...ocrPageNumbers])].sort((a, b) => a - b);

      const rendered = new Map<number, Uint8Array>();
      for (const pageNumber of renderPageNumbers) {
        assertDeadline(deadline);
        try {
          const image = await withDeadline(renderPageAsImage(pdf, pageNumber, {
            canvasImport: () => import("@napi-rs/canvas"),
            scale: 2,
          }), deadline);
          rendered.set(pageNumber, new Uint8Array(image));
        } catch (cause) {
          // Stránku, kterou je nutné přečíst OCR, vykreslit musíme; pro QR
          // nebo pokus o lepší text je selhání jen ztráta bonusu.
          if (cause instanceof LocalOcrError || pagesForOcr.some(page => page.page === pageNumber)) throw cause;
        }
      }
      const qrCodes: string[] = [];
      for (const pageNumber of renderPageNumbers.slice(0, MAX_QR_PAGES + ocrPageNumbers.size)) {
        const image = rendered.get(pageNumber);
        if (!image || deadline - Date.now() < 1_000) continue;
        for (const code of await decodeQrCodesFromImage(image)) if (!qrCodes.includes(code)) qrCodes.push(code);
      }
      const warnings: string[] = damagedPages.length ? [DAMAGED_TEXT_LAYER_WARNING] : [];
      const layoutPages = pages.map(({ page, width, height, lines }) => ({ page, width, height, lines }));
      if (!ocrPageNumbers.size) {
        return { text: pages.map(page => page.text).join("\n\n"), ocrUsed: false, totalPages: pdf.numPages, pagesProcessed: pdf.numPages, averageConfidence: null, warnings, layout: { pages: layoutPages }, isdoc, qrCodes };
      }

      const ocrTargets = [...ocrPageNumbers].sort((a, b) => a - b).filter(pageNumber => rendered.has(pageNumber));
      let recognized: Awaited<ReturnType<typeof recognizeImages>> | null = null;
      try {
        recognized = await recognizeImages(ocrTargets.map(pageNumber => rendered.get(pageNumber)!), deadline, false, ocrTargets);
      } catch (cause) {
        // Když selže jen pokus o lepší text u poškozené vrstvy, zůstane text PDF.
        if (pagesForOcr.length) throw cause;
      }
      const recognizedText = new Map(ocrTargets.map((pageNumber, index) => [pageNumber, recognized?.pages[index] ?? ""]));
      const recognizedLayouts = new Map((recognized?.layout.pages ?? []).map(page => [page.page, page]));
      const recognizedConfidence = recognized?.confidence ?? 0;
      let usedOcr = 0;
      const merged = pages.map(page => {
        const ocrText = recognizedText.get(page.page);
        if (ocrText === undefined) return { text: page.text, layout: null };
        if (pagesForOcr.includes(page)) {
          usedOcr += 1;
          return { text: ocrText, layout: recognizedLayouts.get(page.page) ?? null };
        }
        const better = textQuality(ocrText, recognizedConfidence) > textQuality(repairDroppedGlyphLabels(page.text).text, PDF_TEXT_LAYER_CONFIDENCE);
        if (!better) return { text: page.text, layout: null };
        usedOcr += 1;
        return { text: ocrText, layout: recognizedLayouts.get(page.page) ?? null };
      });
      return {
        text: normalizeOcrText(merged.map(page => page.text).join("\n\n")),
        ocrUsed: usedOcr > 0,
        totalPages: pdf.numPages,
        pagesProcessed: usedOcr || pdf.numPages,
        averageConfidence: usedOcr ? recognized?.confidence ?? null : null,
        warnings: [
          ...warnings,
          ...(usedOcr && usedOcr < pdf.numPages ? ["Část PDF byla přečtena z textové vrstvy a část pomocí OCR."] : []),
          ...(recognized?.enhancedPasses ? ["U hůře čitelné části dokumentu bylo použito zesílené OCR."] : []),
        ],
        layout: { pages: layoutPages.map((page, index) => merged[index].layout ?? page) },
        isdoc,
        qrCodes,
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

// pdfjs (via unpdf's getDocumentProxy, called from extractPdf below) takes
// ownership of `bytes` and detaches its underlying buffer -- after this
// call returns, the same Uint8Array reads back empty. Any caller that needs
// the original bytes again afterward (e.g. to also send the document to an
// AI OCR engine) MUST pass a copy in here (`bytes.slice()`), never the same
// reference. Confirmed by direct testing 2026-09-20: reusing `bytes` for a
// second call after this one silently sent an empty document body.
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
      isdoc: null,
      qrCodes: deadline - Date.now() >= 1_000 ? await decodeQrCodesFromImage(bytes) : [],
    };
  } catch (cause) {
    if (cause instanceof LocalOcrError) throw cause;
    throw new LocalOcrError("invalid_document", "Obrázek se nepodařilo otevřít nebo rozpoznat.");
  }
}
