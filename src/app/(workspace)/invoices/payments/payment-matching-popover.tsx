"use client";

import { CloseIcon } from "@/components/close-icon";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Modal } from "@/components/modal";
import styles from "./payment-matching.module.css";

/** Inline dropdown: stays attached to the invoice field and leaves the page interactive. */
export function MatchingDropdown({ label, trigger, children, className = "", open, onOpenChange }: {
  label: string; trigger: ReactNode; children: (close: () => void) => ReactNode; className?: string;
  open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const panel = anchor.current?.querySelector<HTMLElement>("[data-invoice-dropdown]");
    const field = anchor.current?.parentElement;
    if (!panel || !field) return;
    const position = () => {
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 12;
      const viewportTop = viewport?.offsetTop ?? 0;
      const mobileBar = document.querySelector<HTMLElement>(".mobile-navigation-bar");
      const navigationBottom = mobileBar && getComputedStyle(mobileBar).display !== "none" ? mobileBar.getBoundingClientRect().bottom : 0;
      const topEdge = Math.max(viewportTop, navigationBottom) + 12;
      const rightEdge = leftEdge + (viewport?.width ?? innerWidth) - 24;
      const bottomEdge = viewportTop + (viewport?.height ?? innerHeight) - 12;
      const rect = field.getBoundingClientRect();
      const width = Math.min(440, rightEdge - leftEdge);
      panel.style.width = `${width}px`;
      const desired = Math.min(400, panel.scrollHeight + 2);
      const below = Math.max(0, bottomEdge - rect.bottom - 8);
      const above = Math.max(0, rect.top - 8 - topEdge);
      const upwards = below < desired && above > below;
      const height = Math.min(desired, upwards ? above : below, bottomEdge - topEdge);
      panel.style.maxHeight = `${Math.max(0, height)}px`;
      const top = upwards ? rect.top - 8 - height : rect.bottom + 8;
      panel.style.top = `${Math.max(topEdge, Math.min(top, bottomEdge - height)) - rect.top}px`;
      panel.style.left = `${Math.max(leftEdge, Math.min(rect.right - width, rightEdge - width)) - rect.left}px`;
    };
    position();
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); };
    const onScroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.contains(event.target)) schedule(); };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(panel);
    const workspace = field.closest("[data-payment-matching]");
    if (workspace) observer?.observe(workspace);
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect();
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    anchor.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", outside);
    const node = anchor.current;
    const button = triggerRef.current;
    return () => {
      document.removeEventListener("pointerdown", outside);
      if (node?.contains(document.activeElement) || document.activeElement === document.body) button?.focus();
    };
  }, [open, onOpenChange]);
  const close = () => onOpenChange(false);
  return <div ref={anchor} className={`${styles.anchor} ${styles.dropdownAnchor} ${className}`}
    onKeyDown={event => { if (event.key === "Escape" && open) { event.stopPropagation(); event.preventDefault(); close(); } }}
    onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onOpenChange(false); }}>
    <button ref={triggerRef} type="button" aria-label={label} aria-controls={open ? id : undefined} aria-expanded={open} onClick={() => onOpenChange(!open)}>{trigger}</button>
    {open && <div id={id} role="region" aria-label={label} data-invoice-dropdown className={styles.dropdownPanel}>
      <header className={styles.popupHead}><strong>Vybrat fakturu</strong><button type="button" aria-label="Zavřít" onClick={close}><CloseIcon width="16" height="16" /></button></header>
      {children(close)}
    </div>}
  </div>;
}

/** A native dialog provides focus trapping, Escape and the browser top layer.
 * Desktop positioning follows the trigger; on phones CSS makes it a sheet. */
export function MatchingPopover({ label, trigger, children, wide = false, className = "", open: controlledOpen, onOpenChange }: {
  label: string; trigger: ReactNode; children: (close: () => void) => ReactNode; wide?: boolean; className?: string;
  open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const id = useId();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const position = () => {
      const node = anchor.current;
      const popup = node?.querySelector("dialog");
      const button = node?.querySelector("button");
      if (!node || !popup || !button) return;
      const rect = button.getBoundingClientRect();
      const width = Math.min(wide ? 560 : 380, innerWidth - 24);
      node.style.setProperty("--matching-popup-left", `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`);
      const height = Math.min(popup.scrollHeight, innerHeight - 24);
      node.style.setProperty("--matching-popup-top", `${Math.max(12, Math.min(rect.bottom + 8, innerHeight - height - 12))}px`);
    };
    let frame = 0;
    const schedulePosition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };
    const onScroll = (event: Event) => {
      // Scrolling the invoice choices does not move the trigger.
      if (event.target instanceof Node && anchor.current?.querySelector("dialog")?.contains(event.target)) return;
      schedulePosition();
    };
    schedulePosition();
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedulePosition);
    const workspace = anchor.current?.closest("[data-payment-matching]");
    const popup = anchor.current?.querySelector("dialog");
    if (workspace) observer?.observe(workspace);
    if (popup) observer?.observe(popup);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedulePosition);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, wide, setOpen]);
  return <span ref={anchor} className={`${styles.anchor} ${className}`}>
    <button type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{trigger}</button>
    <Modal open={open} onClose={() => setOpen(false)} labelledBy={id} className={`${styles.popup} ${wide ? styles.wide : ""}`}>
      <header className={styles.popupHead}><h2 id={id}>{label}</h2><button type="button" aria-label="Zavřít" onClick={() => setOpen(false)}><CloseIcon width="16" height="16" /></button></header>
      {children(() => setOpen(false))}
    </Modal>
  </span>;
}

export function MatchingStatus({ label, detail, tone }: { label: string; detail: string; tone: string }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  return <span className={`${styles.statusWrap} ${dismissed ? styles.tooltipDismissed : ""}`} onMouseEnter={() => setDismissed(false)}>
    <button type="button" className={`${styles.statusDot} ${styles[tone]}`} aria-label={label} aria-describedby={id}
      onFocus={() => setDismissed(false)} onClick={() => { setDismissed(false); setShown(value => !value); }} onBlur={() => setShown(false)} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setShown(false); setDismissed(true); } }} />
    <span id={id} role="tooltip" className={`${styles.statusTooltip} ${shown ? styles.shown : ""}`}><strong>{label}</strong>{detail}</span>
  </span>;
}
