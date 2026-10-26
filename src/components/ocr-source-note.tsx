"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OcrFieldDecision, OcrFieldSource } from "@/lib/invoice-ocr";
import { ocrSourceLabel } from "@/lib/ocr-field-review";
import styles from "./invoice-review-form.module.css";

export function OcrSourceNote({ source, decision, ico, review = false }: { source?: OcrFieldSource; decision?: OcrFieldDecision; ico?: string; review?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  const show = () => {
    if (!review) return;
    cancelClose();
    window.dispatchEvent(new CustomEvent("ocr-source-open", { detail: id }));
    setOpen(true);
  };
  const leave = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (!anchor.current?.contains(document.activeElement) && !popup.current?.contains(document.activeElement)) setOpen(false);
    }, 180);
  };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !popup.current) return;
    const rect = anchor.current.getBoundingClientRect();
    const node = popup.current;
    node.style.left = `${Math.max(12, Math.min(rect.right - node.offsetWidth, innerWidth - node.offsetWidth - 12))}px`;
    const below = rect.bottom + 8;
    node.style.top = `${Math.max(12, below + node.offsetHeight <= innerHeight - 12 ? below : rect.top - node.offsetHeight - 8)}px`;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const other = (event: Event) => { if ((event as CustomEvent).detail !== id) close(); };
    const scroll = (event: Event) => {
      if (event.target instanceof Element && (popup.current?.contains(event.target) || event.target.closest("[data-ocr-document-panel]"))) return;
      close();
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && !popup.current?.contains(event.target)) close();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", scroll, { capture: true, passive: true });
    window.addEventListener("ocr-source-open", other);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("ocr-source-open", other);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open, id]);
  if (!source && !decision) return null;
  const method = source ? ocrSourceLabel(source.method) : "";
  const documentSource = source && source.page > 0 && source.method !== "ares" && source.method !== "customer";
  const aresUrl = source?.method === "ares" && /^\d{8}$/.test(ico ?? "") ? `https://ares.gov.cz/ekonomicke-subjekty/res/${ico}` : null;
  const status = decision?.status ?? "review";
  const label = status === "verified" ? "Ověřeno" : status === "missing" ? "Doplnit" : "Zkontrolovat";
  const candidates = decision?.candidates ?? [];
  const accessibleDetails = [source ? `Zdroj: ${documentSource ? `strana ${source.page}${source.line ? `, řádek ${source.line}` : ""}, ` : ""}${method}. ${source.text}` : "", ...(decision?.reasons ?? [])].filter(Boolean).join(" ");
  const contents = <>
      {source ? <span className="ocr-tooltip-section"><strong>Zdroj</strong><span>{documentSource ? `Strana ${source.page}${source.line ? `, řádek ${source.line}` : ""} · ` : ""}{method}</span><q>{source.text}</q>{aresUrl && <a href={aresUrl} target="_blank" rel="noopener noreferrer" onClick={event => event.stopPropagation()}>Otevřít záznam v ARES ↗</a>}</span> : null}
      {decision?.reasons.length ? <span className="ocr-tooltip-section"><strong>Proč zkontrolovat</strong><span>{decision.reasons.join(" ")}</span></span> : null}
      {candidates.length > 1 || (!source && candidates.length > 0) ? <span className="ocr-tooltip-section"><strong>Nalezené možnosti</strong>{candidates.map((candidate, index) => <span className="ocr-field-candidate" key={`${candidate.method}-${candidate.page}-${candidate.value}-${index}`}><b>{candidate.value}</b><small>Strana {candidate.page} · {ocrSourceLabel(candidate.method)}</small><q>{candidate.text}</q></span>)}</span> : null}
      {!source && !decision?.reasons.length && !candidates.length ? <span>OCR k tomuto poli nemá další podrobnosti.</span> : null}  </>;
  return <>
    <span ref={anchor} className={`ocr-field-meta ${status}`} data-popup-anchor={!review || undefined} tabIndex={0} role="note" aria-label={`${label}. ${accessibleDetails}`} aria-describedby={open ? id : undefined}
      onMouseEnter={show} onFocus={show} onMouseLeave={leave}
      onClick={event => { if (review) { event.preventDefault(); event.stopPropagation(); show(); } }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !popup.current?.contains(event.relatedTarget)) setOpen(false); }}>
      <span className="ocr-field-status">{label}</span>
      {source && <span className="ocr-field-origin">{source.method === "pdf_text" || source.method === "ocr" ? "Faktura" : method}</span>}
      {!review && <span className="ocr-field-tooltip" role="tooltip" data-popup>{contents}</span>}
    </span>
    {review && open && createPortal(<span ref={popup} id={id} className={styles.sourceTooltip} role="tooltip" data-ocr-source onMouseEnter={cancelClose} onMouseLeave={leave} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && !anchor.current?.contains(event.relatedTarget)) setOpen(false); }}>{contents}</span>, document.body)}
  </>;
}
