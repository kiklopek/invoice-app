"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { responsiveMoneyOptions } from "@/lib/money-display";
import styles from "./money-amount.module.css";

type MoneyProps = { value: number; currency?: string; className?: string; danger?: boolean };

/** Both operational amounts and summaries fit the actual space, not a device breakpoint. */
function FittingMoney({ value, currency = "CZK", className = "", danger = false, summary = false }: MoneyProps & { summary?: boolean }) {
  const options = useMemo(() => responsiveMoneyOptions(value, currency), [value, currency]);
  const measurements = useRef<HTMLSpanElement>(null);
  const [choice, setChoice] = useState({ options, index: 0, scale: 1 });
  const index = choice.options === options ? choice.index : 0;
  const amount = { exact: options[0], text: options[index], compact: index > 0 };
  const id = useId();
  const anchor = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = anchor.current, probe = measurements.current;
    if (!node || !probe) return;
    const fit = () => {
      const width = node.getBoundingClientRect().width;
      if (!width) return;
      const candidates = Array.from(probe.children);
      const found = candidates.findIndex(candidate => candidate.getBoundingClientRect().width <= width + .5);
      const next = found < 0 ? options.length - 1 : found;
      const minimumWidth = candidates[next]?.getBoundingClientRect().width || 1;
      const scale = found < 0 ? Math.min(1, Math.floor(width / minimumWidth * .96 * 1000) / 1000) : 1;
      setChoice(current => current.options === options && current.index === next && current.scale === scale ? current : { options, index: next, scale });
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    // Font loading can alter glyph widths without changing the allocated space.
    for (const child of Array.from(probe.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [options]);
  const popup = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }
  function show() { cancelClose(); if (amount.compact) setOpen(true); }
  function leave() { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 150); }
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !popup.current) return;
    const a = anchor.current.getBoundingClientRect(), p = popup.current.getBoundingClientRect();
    setPosition({
      left: Math.max(12, Math.min(a.left + a.width / 2 - p.width / 2, window.innerWidth - p.width - 12)),
      top: Math.max(12, a.bottom + p.height + 8 < window.innerHeight ? a.bottom + 8 : a.top - p.height - 8),
    });
  }, [open, amount.exact]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const outside = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const Tag = summary ? "strong" : "span";
  return <>
    <Tag ref={anchor} className={`${styles.fitting} ${summary ? styles.main : styles.exact} ${className}`} data-money-main={summary || undefined} data-money-value data-danger={danger || undefined}
      title={amount.exact} aria-label={amount.exact} tabIndex={amount.compact ? 0 : undefined}
      aria-describedby={open && amount.compact ? id : undefined}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={leave} onClick={event => { if (amount.compact) { event.preventDefault(); event.stopPropagation(); show(); } }}
      onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); show(); } }}
    >
      <span ref={measurements} className={styles.measurements} aria-hidden="true">{options.map((text, i) => <span key={text} data-alternative={i > 0 || undefined}>{text}</span>)}</span>
      <span className={styles.visible} data-money-visible style={choice.options === options && choice.scale < 1 ? { fontSize: `max(12px, ${choice.scale}em)`, whiteSpace: "normal", overflowWrap: "anywhere" } : undefined}>{amount.text}</span>
    </Tag>
    {open && amount.compact && createPortal(<span ref={popup} id={id} role="tooltip" className={styles.tooltip}
      style={position} onMouseEnter={cancelClose} onMouseLeave={leave}>{amount.exact}</span>, document.body)}
  </>;
}

/** Kept as a shared entry point so every existing financial readout adapts consistently. */
export function ExactMoney(props: MoneyProps) { return <FittingMoney {...props} />; }
export function SummaryMoney(props: MoneyProps) { return <FittingMoney {...props} summary />; }
