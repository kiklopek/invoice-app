import "server-only";

import { access, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import { definePDFJSModule, extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import { normalizeOcrText } from "./invoice-ocr";

export const MAX_TEXT_PDF_PAGES = 30;
export const MAX_SCANNED_PDF_PAGES = 8;
export const OCR_TIMEOUT_MS = 50_000;
const MIN_TEXT_LAYER_CHARACTERS = 40;

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
  const input = sharp(bytes, { failOn: "error", limitInputPixels: 20_000_000 });
  const metadata = await input.metadata();
  const sourceWidth = metadata.width ?? 1800;
  const enlargement = Math.max(1, Math.min(3, 1800 / sourceWidth));
  const targetWidth = Math.min(2200, Math.round(sourceWidth * enlargement));

  return new Uint8Array(await sharp(bytes, { failOn: "error", limitInputPixels: 20_000_000 })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: targetWidth,
      height: 3000,
      fit: "inside",
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1 })
    .extend({ top: 18, bottom: 18, left: 18, right: 18, background: "#ffffff" })
    .png({ compressionLevel: 6 })
    .toBuffer());
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

async function recognizeImages(images: Uint8Array[], deadline: number, includeCounterpartyDetail = false) {
  let worker: Worker | null = null;
  let languageDirectory: string | null = null;
  const texts: string[] = [];
  const confidences: number[] = [];
  try {
    const localWorker = await createLocalWorker();
    worker = localWorker.worker;
    languageDirectory = localWorker.languageDirectory;
    assertDeadline(deadline);
    for (const image of images) {
      assertDeadline(deadline);
      const normalized = await withDeadline(preprocessImage(image), deadline);
      const result = await withDeadline(worker.recognize(Buffer.from(normalized), { rotateAuto: true }), deadline);
      texts.push(result.data.text);
      if (Number.isFinite(result.data.confidence)) confidences.push(result.data.confidence);

      if (includeCounterpartyDetail && images.length === 1) {
        const metadata = await withDeadline(sharp(normalized).metadata(), deadline);
        const width = metadata.width ?? 0;
        const height = metadata.height ?? 0;
        if (width >= 600 && height >= 600) {
          const left = Math.floor(width * 0.42);
          const detail = await withDeadline(sharp(normalized)
            .extract({ left, top: 0, width: width - left, height: Math.floor(height * 0.62) })
            .extend({ top: 24, bottom: 24, left: 24, right: 24, background: "#ffffff" })
            .png({ compressionLevel: 6 })
            .toBuffer(), deadline);
          const detailResult = await withDeadline(worker.recognize(detail, { rotateAuto: false }), deadline);
          texts.push(`ODBĚRATEL DETAIL\n${detailResult.data.text}`);
          if (Number.isFinite(detailResult.data.confidence)) confidences.push(detailResult.data.confidence);
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
      const extracted = await withDeadline(extractText(pdf, { mergePages: false }), deadline);
      const pages = extracted.text.map(page => normalizeOcrText(page));
      const pagesForOcr = pages.map((text, index) => ({ text, page: index + 1 })).filter(item => item.text.replace(/\s/g, "").length < MIN_TEXT_LAYER_CHARACTERS);
      if (!pagesForOcr.length) {
        return { text: pages.join("\n\n"), ocrUsed: false, totalPages: pdf.numPages, pagesProcessed: pdf.numPages, averageConfidence: null, warnings: [] };
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
      const recognized = await recognizeImages(rendered, deadline);
      let recognizedIndex = 0;
      const merged = pages.map(page => page.replace(/\s/g, "").length >= MIN_TEXT_LAYER_CHARACTERS ? page : recognized.pages[recognizedIndex++] ?? "");
      return {
        text: normalizeOcrText(merged.join("\n\n")),
        ocrUsed: true,
        totalPages: pdf.numPages,
        pagesProcessed: pagesForOcr.length,
        averageConfidence: recognized.confidence,
        warnings: pagesForOcr.length < pdf.numPages ? ["Část PDF byla přečtena z textové vrstvy a část pomocí OCR."] : [],
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
    return { text: recognized.text, ocrUsed: true, totalPages: 1, pagesProcessed: 1, averageConfidence: recognized.confidence, warnings: [] };
  } catch (cause) {
    if (cause instanceof LocalOcrError) throw cause;
    throw new LocalOcrError("invalid_document", "Obrázek se nepodařilo otevřít nebo rozpoznat.");
  }
}
