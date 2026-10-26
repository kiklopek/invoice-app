"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OcrBoundingBox } from "@/lib/invoice-ocr";
import { boundsToPercentStyle, locateValueInLayout, textItemBounds, type DocumentHighlight, type LayoutTextItem } from "@/lib/document-locate";

type PdfJs = typeof import("pdfjs-dist");
type PdfLoadingTask = ReturnType<PdfJs["getDocument"]>;
type PdfDocument = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const PAGE_GAP = 12;

type PageSize = { width: number; height: number };
type Located = { key: string; page: number; bounds: OcrBoundingBox } | { key: string; notfound: true } | null;

function isPdf(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

async function loadPdfJs(): Promise<PdfJs> {
  const pdfjs = (await import("pdfjs-dist/build/pdf.mjs")) as unknown as PdfJs;
  // Worker běží ze stejného originu (CSP nepouští CDN). `new URL(..., import.meta.url)`
  // tu nejde: pdfjs-dist je v serverExternalPackages a webpack při SSR kompilaci
  // hlásí "ESM packages need to be imported". Soubor proto leží v public/pdfjs/.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  return pdfjs;
}

function HighlightBox({ bounds, label, approximate }: { bounds: OcrBoundingBox; label?: string; approximate?: boolean }) {
  return <div className={`document-preview-highlight${approximate ? " approximate" : ""}`} data-highlight style={boundsToPercentStyle(bounds)} aria-label={approximate ? "Přibližná oblast údaje z OCR" : label ? `Zvýrazněno: ${label}` : "Zvýrazněné místo v dokladu"} role="img"/>;
}

function PdfPage({ pdf, pageNumber, size, cssWidth, highlight, scroller }: {
  pdf: PdfDocument;
  pageNumber: number;
  size: PageSize;
  cssWidth: number;
  highlight: { bounds: OcrBoundingBox; label?: string; approximate?: boolean } | null;
  scroller: HTMLElement | null;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(pageNumber === 1);
  const cssHeight = (cssWidth / size.width) * size.height;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setVisible(true); }, { root: scroller, rootMargin: "800px 0px" });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [scroller]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<unknown> } | null = null;
    void (async () => {
      const page = await pdf.getPage(pageNumber);
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: (cssWidth / size.width) * ratio });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport });
      try { await task.promise; } catch { /* zrušené vykreslení při změně velikosti */ }
    })().catch(() => undefined);
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, pageNumber, size.width, cssWidth, visible]);

  // Selectable text comes only from the original PDF, independently of OCR.
  // Use CSS pixels here; the canvas separately accounts for devicePixelRatio.
  useEffect(() => {
    if (!visible) return;
    const container = textLayerRef.current;
    if (!container) return;
    let cancelled = false;
    let layer: InstanceType<PdfJs["TextLayer"]> | null = null;
    container.replaceChildren();
    void (async () => {
      const [pdfjs, page] = await Promise.all([loadPdfJs(), pdf.getPage(pageNumber)]);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: cssWidth / size.width });
      container.style.setProperty("--total-scale-factor", String(viewport.scale));
      layer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container,
        viewport,
      });
      await layer.render();
    })().catch(() => { if (!cancelled) container.replaceChildren(); });
    return () => { cancelled = true; layer?.cancel(); container.replaceChildren(); };
  }, [pdf, pageNumber, size.width, cssWidth, visible]);

  return <div ref={wrapperRef} className="document-preview-page" data-page={pageNumber} style={{ width: cssWidth, height: cssHeight }}>
    <canvas ref={canvasRef} aria-label={`Strana ${pageNumber}`} role="img"/>
    <div ref={textLayerRef} className="document-preview-text-layer"/>
    {highlight && <HighlightBox bounds={highlight.bounds} label={highlight.label} approximate={highlight.approximate}/>}
  </div>;
}

export function DocumentPreview({ file, highlight, kind = "original" }: { file: File; highlight?: DocumentHighlight | null; kind?: "original" | "report" | "invoice" }) {
  const pdfFile = isPdf(file);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [located, setLocated] = useState<Located>(null);
  const highlightKey = highlight ? JSON.stringify(highlight) : "";
  const textCache = useRef(new Map<number, LayoutTextItem[]>());
  const zoomAnchor = useRef<{ top: number; left: number; ratio: number } | null>(null);
  useLayoutEffect(() => {
    const node = scrollerRef.current;
    const anchor = zoomAnchor.current;
    if (!node || !anchor) return;
    node.scrollTo({ top: anchor.top * anchor.ratio, left: anchor.left * anchor.ratio, behavior: "instant" });
    zoomAnchor.current = null;
  }, [zoom]);

  const setScrollerNode = useCallback((node: HTMLDivElement | null) => { scrollerRef.current = node; setScroller(node); }, []);

  // Blob URL pro obrázek a pro odkaz „Stáhnout dokument“; při změně souboru se uvolní.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setDownloadUrl(url);
    setImageUrl(pdfFile ? null : url);
    return () => { URL.revokeObjectURL(url); };
  }, [file, pdfFile]);

  useEffect(() => {
    if (!scroller) return;
    const update = () => {
      const styles = window.getComputedStyle(scroller);
      setContainerWidth(Math.max(0, scroller.clientWidth - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight)));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller]);

  // Načtení dokumentu. Selhání nikdy neblokuje formulář -- jen ukáže chybu a odkaz ke stažení.
  useEffect(() => {
    let cancelled = false;
    let loadingTask: PdfLoadingTask | null = null;
    textCache.current = new Map();
    setStatus("loading"); setPdf(null); setPageSizes([]); setTotalPages(0); setCurrentPage(1); setLocated(null); setZoom(1);
    if (!pdfFile) return;
    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const data = new Uint8Array(await file.arrayBuffer());
        // pdfjs-dist 6 už volbu isEvalSupported nezná: funkce z PDF se
        // vyhodnocují vlastním interpretem, ne dynamickým spouštěním kódu.
        loadingTask = pdfjs.getDocument({
          data,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
          iccUrl: "/pdfjs/iccs/",
        });
        const loaded = await loadingTask.promise;
        if (cancelled) return;
        const sizes: PageSize[] = [];
        for (let start = 1; start <= loaded.numPages; start += 8) {
          const batch = await Promise.all(Array.from({ length: Math.min(8, loaded.numPages - start + 1) }, async (_, offset) => {
            const viewport = (await loaded.getPage(start + offset)).getViewport({ scale: 1 });
            return { width: viewport.width, height: viewport.height };
          }));
          if (cancelled) return;
          sizes.push(...batch);
        }
        if (cancelled) return;
        setPdf(loaded); setPageSizes(sizes); setTotalPages(loaded.numPages); setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; void loadingTask?.destroy(); };
  }, [file, pdfFile]);

  // V textovém PDF hledáme skutečnou hodnotu, ne box celého řádku z OCR.
  // U skenu lze ukázat jen přibližný řádek, který se odlišuje v náhledu.
  useEffect(() => {
    let cancelled = false;
    if (!highlight || (highlight.bounds && !pdfFile)) { setLocated(null); return; }
    if (!pdfFile || !highlight.kind || highlight.value === undefined) { setLocated({ key: highlightKey, notfound: true }); return; }
    if (!pdf) { setLocated(null); return; }
    if (highlight.page < 1 || highlight.page > pageSizes.length) { setLocated({ key: highlightKey, notfound: true }); return; }
    const page = highlight.page;
    const kind = highlight.kind;
    const value = highlight.value;
    void (async () => {
      let items = textCache.current.get(page);
      if (!items) {
        const pdfPage = await pdf.getPage(page);
        const viewport = pdfPage.getViewport({ scale: 1 });
        const content = await pdfPage.getTextContent();
        const measure = document.createElement("canvas").getContext("2d");
        items = content.items.flatMap(entry => {
          if (!("str" in entry) || !entry.str.trim()) return [];
          const style = content.styles[entry.fontName];
          const font = `${Math.hypot(entry.transform[2], entry.transform[3]) || entry.height || 12}px ${style?.fontFamily || "sans-serif"}`;
          return [{
            text: entry.str,
            bounds: textItemBounds(entry.transform, entry.width, entry.height, viewport, style?.ascent),
            measureText: measure ? (text: string) => { measure.font = font; return measure.measureText(text).width; } : undefined,
          }];
        });
        textCache.current.set(page, items);
      }
      if (cancelled) return;
      const match = locateValueInLayout(value, kind, items, highlight.text, highlight.bounds);
      setLocated(match ? { key: highlightKey, page, bounds: match.bounds } : { key: highlightKey, notfound: true });
    })().catch(() => { if (!cancelled) setLocated({ key: highlightKey, notfound: true }); });
    return () => { cancelled = true; };
  }, [highlight, highlightKey, pdf, pdfFile, pageSizes.length]);

  const effective = useMemo(() => {
    if (!highlight) return null;
    // OCR obvykle vrací box celého řádku. U textového PDF hledáme přímo
    // hodnotu, jinak by rámeček mířil na popisek nebo sousední údaj.
    if (highlight.bounds && !pdfFile) return { page: highlight.page, bounds: highlight.bounds };
    if (located?.key === highlightKey && "bounds" in located) return located;
    if (highlight.method === "ocr" && highlight.bounds && located?.key === highlightKey && "notfound" in located) return { page: highlight.page, bounds: highlight.bounds };
    return null;
  }, [highlight, highlightKey, located, pdfFile]);
  const approximate = Boolean(effective && highlight?.method === "ocr" && (!pdfFile || (located?.key === highlightKey && "notfound" in located)));

  // Plynulé posunutí na zvýrazněné místo.
  useEffect(() => {
    if (!effective || !scroller) return;
    const frame = window.requestAnimationFrame(() => {
      const target = scroller.querySelector<HTMLElement>("[data-highlight]");
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (!target) return;
      const targetRect = target.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      scroller.scrollTo({
        top: scroller.scrollTop + targetRect.top - scrollerRect.top - (scroller.clientHeight - targetRect.height) / 2,
        left: scroller.scrollLeft + targetRect.left - scrollerRect.left - (scroller.clientWidth - targetRect.width) / 2,
        behavior: reduced ? "instant" : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [effective, scroller, status, containerWidth]);

  const onScroll = () => {
    const node = scrollerRef.current;
    if (!node) return;
    const middle = node.getBoundingClientRect().top + node.clientHeight / 3;
    let current = 1;
    node.querySelectorAll<HTMLElement>("[data-page]").forEach(element => {
      if (element.getBoundingClientRect().top <= middle) current = Number(element.dataset.page);
    });
    setCurrentPage(current);
  };

  const outsideRenderedPages = Boolean(highlight?.bounds && pdfFile && status === "ready" && highlight.page > pageSizes.length);
  const notFound = Boolean(highlight && !effective && ((located?.key === highlightKey && "notfound" in located) || outsideRenderedPages));
  const setDocumentZoom = (nextZoom: number) => {
    const node = scrollerRef.current;
    if (node) zoomAnchor.current = { top: node.scrollTop, left: node.scrollLeft, ratio: nextZoom / zoom };
    setZoom(nextZoom);
  };
  const changeZoom = (delta: number) => setDocumentZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((zoom + delta) * 100) / 100)));
  const goToPage = (page: number) => {
    const node = scrollerRef.current;
    const target = node?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (!node || !target) return;
    node.scrollTo({ top: node.scrollTop + target.getBoundingClientRect().top - node.getBoundingClientRect().top, behavior: "instant" });
    setCurrentPage(page);
  };
  const highlightLabel = highlight?.text ?? (highlight?.value !== undefined ? String(highlight.value) : undefined);

  return <div className="document-preview">
    <div className="document-preview-toolbar" role="toolbar" aria-label="Ovládání náhledu dokladu">
      <div className="document-preview-title"><strong title={file.name}>{file.name}</strong><span className="document-preview-eyebrow">{kind === "report" ? "Vygenerovaný report" : kind === "invoice" ? "PDF faktury" : "Původní doklad"} · {new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(file.size / 1024)} kB</span></div>
      {pdfFile && status === "ready" && totalPages > 0 && <div className="document-preview-pagination">
        <button type="button" className="btn secondary compact" aria-label="Předchozí strana" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)}>‹</button>
        <span className="document-preview-pages" aria-live="polite">Strana {currentPage} / {totalPages}</span>
        <button type="button" className="btn secondary compact" aria-label="Další strana" disabled={currentPage >= totalPages} onClick={() => goToPage(currentPage + 1)}>›</button>
      </div>}
      <div className="document-preview-zoom">
        <button type="button" className="btn secondary compact" onClick={() => changeZoom(-ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} aria-label="Oddálit">−</button>
        <span aria-live="polite">{Math.round(zoom * 100)} %</span>
        <button type="button" className="btn secondary compact" onClick={() => changeZoom(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} aria-label="Přiblížit">+</button>
        <button type="button" className="btn secondary compact" aria-label="Přizpůsobit šířce" title="Přizpůsobit šířce" onClick={() => setDocumentZoom(1)} disabled={zoom === 1}>⤢</button>
      </div>
    </div>
    {notFound && <p className="document-preview-note" role="status">Místo v dokladu se nepodařilo dohledat jednoznačně. Zkontrolujte hodnotu ručně.</p>}
    {approximate && <p className="document-preview-note" role="status">OCR zná jen přibližnou oblast řádku. Ověřte konkrétní hodnotu v dokladu.</p>}
    <div className="document-preview-scroller" ref={setScrollerNode} onScroll={onScroll} tabIndex={0} aria-label="Náhled dokladu">
      {pdfFile && status === "loading" && <p className="document-preview-state" role="status">Načítám náhled dokladu…</p>}
      {status === "error" && <div className="document-preview-state document-preview-error" role="alert">
        <p>{kind !== "original" ? "Náhled PDF se nepodařilo zobrazit. Stejný PDF soubor můžete stáhnout nebo otevřít samostatně." : "Náhled dokumentu se nepodařilo zobrazit. Údaje vlevo můžete zkontrolovat i bez něj."}</p>
        {downloadUrl && <a className="btn secondary compact" href={downloadUrl} download={file.name}>Stáhnout dokument</a>}
      </div>}
      {pdfFile && status === "ready" && pdf && <div className="document-preview-pages-list" style={{ gap: PAGE_GAP }}>
        {pageSizes.map((size, index) => <PdfPage
          key={`${file.name}-${index}`}
          pdf={pdf}
          pageNumber={index + 1}
          size={size}
          cssWidth={Math.max(120, containerWidth * zoom)}
          scroller={scroller}
          highlight={effective && effective.page === index + 1 ? { bounds: effective.bounds, label: highlightLabel, approximate } : null}
        />)}
      </div>}
      {!pdfFile && imageUrl && status !== "error" && <div className="document-preview-image" style={{ width: `${zoom * 100}%` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- blob URL z paměti prohlížeče, next/image zde nejde použít */}
        <img src={imageUrl} alt={`Doklad ${file.name}`} onError={() => setStatus("error")} onLoad={() => setStatus("ready")}/>
        {effective && effective.page <= 1 && <HighlightBox bounds={effective.bounds} label={highlightLabel} approximate={approximate}/>}
      </div>}
    </div>
  </div>;
}

/** A real first-page thumbnail using the same PDF renderer as the full preview. */
export function DocumentThumbnail({ file }: { file: File }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let task: PdfLoadingTask | null = null;
    let render: { cancel(): void; promise: Promise<unknown> } | null = null;
    let imageUrl: string | null = null;
    setFailed(false); setReady(false);
    if (!isPdf(file)) {
      if (!file.type.startsWith("image/")) { setFailed(true); return; }
      imageUrl = URL.createObjectURL(file); setImage(imageUrl);
      return () => { if (imageUrl) URL.revokeObjectURL(imageUrl); };
    }
    setImage(null);
    void (async () => {
      const [pdfjs, buffer] = await Promise.all([loadPdfJs(), file.arrayBuffer()]);
      if (cancelled) return;
      task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      if (cancelled || !canvas.current) return;
      const size = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 320 / size.width });
      canvas.current.width = Math.ceil(viewport.width); canvas.current.height = Math.ceil(viewport.height);
      render = page.render({ canvas: canvas.current, viewport });
      await render.promise;
      if (!cancelled) setReady(true);
    })().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; render?.cancel(); void task?.destroy(); };
  }, [file]);
  if (failed) return <span>Náhled není dostupný. Otevřít dokument.</span>;
  // A private blob URL is used only for the authenticated original image.
  // eslint-disable-next-line @next/next/no-img-element
  if (image) return <img src={image} alt="Originální dokument faktury" onError={() => setFailed(true)} />;
  return <><canvas ref={canvas} role="img" aria-label="První strana originální faktury" data-ready={ready} style={{ display: ready ? undefined : "none" }} />{!ready && <span role="status">Načítání náhledu…</span>}</>;
}
