"use client";

import { useEffect } from "react";
import { fitPopup } from "@/lib/popup-fit";

const layers = new WeakMap<HTMLElement, { width: number; above: boolean }>();

function hide(popup: HTMLElement) {
  if (popup.hasAttribute("popover") && popup.matches(":popover-open")) popup.hidePopover();
  popup.removeAttribute("data-fitted");
}

// Hlídá všechna otevírací okna označená `data-popup` a drží je uvnitř
// obrazovky (výpočet v src/lib/popup-fit.ts). Okno se otevírá:
// - v <details> (menu pod třemi tečkami) -> při otevření,
// - na najetí nebo fokus prvku `data-popup-anchor` (nápovědy),
// - vložením do stránky (našeptávače),
// a přepočítá se při změně velikosti okna. Nové okno stačí označit
// `data-popup`; posun nese CSS proměnná --popup-shift-x a data-placement.
function anchorOf(popup: HTMLElement) {
  const details = popup.closest("details");
  return (details?.querySelector(":scope > summary") as HTMLElement | null)
    ?? (popup.closest("[data-popup-anchor]") as HTMLElement | null) ?? popup.parentElement ?? popup;
}

function fit(popup: HTMLElement) {
  if (!popup.isConnected) return;
  if (popup.closest("details:not([open])")) { hide(popup); return; }
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? document.documentElement.clientWidth;
  const height = viewport?.height ?? window.innerHeight;
  popup.style.setProperty("--popup-max-width", `${Math.max(0, width - 24)}px`);
  popup.style.setProperty("--popup-max-height", `${Math.max(0, height - 24)}px`);
  popup.style.removeProperty("--popup-shift-x");
  popup.style.removeProperty("--popup-shift-y");
  popup.removeAttribute("data-placement");
  const anchor = anchorOf(popup).getBoundingClientRect();
  // The top layer also escapes clipping by cards and scrolling tables, while
  // retaining the DOM relationship, click handlers and tab order in <details>.
  if (popup.parentElement instanceof HTMLDetailsElement && typeof popup.showPopover === "function") {
    let layer = layers.get(popup);
    if (!layer) {
      const natural = popup.getBoundingClientRect();
      if (!natural.width || !natural.height) return;
      layer = { width: natural.width, above: natural.bottom <= anchor.top };
      layers.set(popup, layer);
      popup.setAttribute("popover", "manual");
      popup.setAttribute("data-popup-layer", "");
    }
    popup.style.setProperty("--popup-width", `${layer.width}px`);
    popup.style.setProperty("--popup-left", `${anchor.right - Math.min(layer.width, width - 24)}px`);
    popup.style.setProperty("--popup-top", `${anchor.bottom + 8}px`);
    if (!popup.matches(":popover-open")) popup.showPopover();
    const popupHeight = popup.getBoundingClientRect().height;
    const above = anchor.top - top - 20;
    const below = top + height - 20 - anchor.bottom;
    if ((layer.above || popupHeight > below) && above > below)
      popup.style.setProperty("--popup-top", `${anchor.top - 8 - popupHeight}px`);
  }
  const rect = popup.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const result = fitPopup({
    popup: { ...rect.toJSON(), top: rect.top - top, bottom: rect.bottom - top, left: rect.left - left, right: rect.right - left },
    anchor: { ...anchor.toJSON(), top: anchor.top - top, bottom: anchor.bottom - top },
    viewport: { width, height },
  });
  if (result.placement && !layers.has(popup)) popup.setAttribute("data-placement", result.placement);
  // Flipping alone is insufficient for a tall popup or an offscreen anchor.
  // Clamp the final measured box on both axes, including a panned/zoomed viewport.
  const placed = popup.getBoundingClientRect();
  const shiftX = Math.max(left + 12 - placed.left, Math.min(0, left + width - 12 - placed.right));
  const shiftY = Math.max(top + 12 - placed.top, Math.min(0, top + height - 12 - placed.bottom));
  popup.style.setProperty("--popup-shift-x", `${shiftX}px`);
  popup.style.setProperty("--popup-shift-y", `${shiftY}px`);
  popup.setAttribute("data-fitted", "");
}

function popupsIn(root: Element | null) {
  if (!root) return [];
  const own = root.matches("[data-popup]") ? [root as HTMLElement] : [];
  return [...own, ...root.querySelectorAll<HTMLElement>("[data-popup]")];
}

export function PopupFitter() {
  useEffect(() => {
    let frame = 0;
    const observed = new Set<HTMLElement>();
    const sizeObserver = new ResizeObserver(() => schedule());
    const track = (popup: HTMLElement) => {
      if (!observed.has(popup)) { observed.add(popup); sizeObserver.observe(popup); }
      fit(popup);
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        for (const popup of observed) {
          if (!popup.isConnected) { observed.delete(popup); sizeObserver.unobserve(popup); }
          else fit(popup);
        }
      });
    };
    const onToggle = (event: Event) => {
      const details = event.target as HTMLDetailsElement;
      if (!(details instanceof HTMLDetailsElement)) return;
      for (const popup of details.querySelectorAll<HTMLElement>(":scope > [data-popup]")) {
        if (details.open) track(popup);
        else hide(popup);
      }
    };
    const onEnter = (event: Event) => {
      const anchor = (event.target as Element | null)?.closest?.("[data-popup-anchor]");
      if (anchor) for (const popup of anchor.querySelectorAll<HTMLElement>("[data-popup]")) track(popup);
    };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) for (const popup of popupsIn(node)) track(popup);
        }
      }
      schedule();
    });

    // toggle nebublá, proto zachytávání.
    document.addEventListener("toggle", onToggle, true);
    document.addEventListener("pointerover", onEnter);
    document.addEventListener("focusin", onEnter);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    for (const popup of document.querySelectorAll<HTMLElement>("[data-popup]")) track(popup);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      document.removeEventListener("toggle", onToggle, true);
      document.removeEventListener("pointerover", onEnter);
      document.removeEventListener("focusin", onEnter);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame);
      for (const popup of observed) hide(popup);
      sizeObserver.disconnect();
      observer.disconnect();
    };
  }, []);
  return null;
}
