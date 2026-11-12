"use client";

import { CloseIcon } from "@/components/close-icon";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Modal } from "@/components/modal";
import styles from "./payment-matching.module.css";

/** Inline dropdown: stays attached to the invoice field and leaves the page interactive. */
export function MatchingDropdown({ label, trigger, children, className = "", open, onOpenChange, subtitle }: {
  label: string; trigger: ReactNode; children: (close: () => void) => ReactNode; className?: string;
  open: boolean; onOpenChange: (open: boolean) => void;
  /** Co se přiřazuje (např. částka a plátce), pod nadpisem „Vybrat fakturu“. */
  subtitle?: ReactNode;
}) {
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const panel = anchor.current?.querySelector<HTMLElement>("[data-invoice-dropdown]");
    const field = anchor.current?.parentElement;
    if (!panel || !field) return;
    // Pevná poloha: směr (pod polem, nebo nad ním), výška i odstup od horního
    // okraje pole se určí jednou při otevření. Panel je ukotvený k poli, takže
    // se s řádkem jen posouvá; při posouvání stránky, psaní ani když řádek
    // naroste (vybrané faktury), se nepřeklápí, neposouvá a nemění výšku.
    let offset: number | null = null;
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
      panel.style.left = `${Math.max(leftEdge, Math.min(rect.right - width, rightEdge - width)) - rect.left}px`;
      if (offset !== null) return;
      // Velikost podle obsahu při otevření (seznamy, které se posouvají uvnitř,
      // se započítají celé). Výběr faktury má aspoň 380 px, aby se vešly
      // i vybrané faktury při rozdělení; pak už se výška nemění.
      panel.style.height = "auto";
      const hidden = [...panel.children].reduce((sum, child) => sum + Math.max(0, child.scrollHeight - child.clientHeight), 0);
      const natural = panel.scrollHeight + hidden + 2;
      const desired = Math.min(560, panel.querySelector("[data-picker-body]") ? Math.max(380, natural) : natural);
      const below = Math.max(0, bottomEdge - rect.bottom - 8);
      const above = Math.max(0, rect.top - 8 - topEdge);
      const upwards = below < desired && above > below;
      const height = Math.max(0, Math.min(desired, upwards ? above : below, bottomEdge - topEdge));
      // Pole mimo obrazovku (např. po vyjetí klávesnice): panel zůstane uvnitř okna.
      const top = upwards ? rect.top - 8 - height : rect.bottom + 8;
      offset = Math.max(topEdge, Math.min(top, bottomEdge - height)) - rect.top;
      panel.style.height = panel.style.maxHeight = `${height}px`;
      panel.style.top = `${offset}px`;
    };
    position();
    // Jen když se změní velikost okna (např. na mobilu vyjede klávesnice),
    // panel se znovu umístí, aby nevypadl z obrazovky. Posouvání ne.
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { offset = null; position(); }); };
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("resize", schedule); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    // Fokus do vyhledávání, ne na zaškrtávací políčko nad ním.
    anchor.current?.querySelector<HTMLInputElement>("input:not([type=checkbox]):not([type=radio])")?.focus({ preventScroll: true });
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
      <header className={styles.popupHead}><div className={styles.popupTitle}><strong>Vybrat fakturu</strong>{subtitle && <small>{subtitle}</small>}</div><button type="button" aria-label="Zavřít" onClick={close}><CloseIcon width="16" height="16" /></button></header>
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
      // Large screens zoom dialogs (--ui-zoom): its left/top are then in zoomed
      // units, so the position measured in window pixels is divided by the
      // dialog's real scale. Without it the popover slid off to the right.
      const box = popup.getBoundingClientRect();
      const cssWidth = parseFloat(getComputedStyle(popup).width) || box.width;
      const scale = box.width > 0 && cssWidth > 0 ? box.width / cssWidth : 1;
      const width = box.width || Math.min(wide ? 560 : 380, innerWidth - 24);
      const height = Math.min(box.height || popup.scrollHeight, innerHeight - 24);
      const left = Math.max(12, Math.min(rect.left, innerWidth - width - 12));
      const top = Math.max(12, Math.min(rect.bottom + 8, innerHeight - height - 12));
      node.style.setProperty("--matching-popup-left", `${left / scale}px`);
      node.style.setProperty("--matching-popup-top", `${top / scale}px`);
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
    // Place it before the first paint as well, so it does not jump from the corner.
    position();
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
