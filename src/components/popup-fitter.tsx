"use client";

import { useEffect } from "react";
import { fitPopup } from "@/lib/popup-fit";

// Hlídá všechna otevírací okna označená `data-popup` a drží je uvnitř
// obrazovky (výpočet v src/lib/popup-fit.ts). Okno se otevírá:
// - v <details> (menu pod třemi tečkami) -> při otevření,
// - na najetí nebo fokus prvku `data-popup-anchor` (nápovědy),
// - vložením do stránky (našeptávače),
// a přepočítá se při změně velikosti okna. Nové okno stačí označit
// `data-popup`; posun nese CSS proměnná --popup-shift-x a data-placement.
function anchorOf(popup: HTMLElement) {
  return (popup.closest("details, [data-popup-anchor]") as HTMLElement | null) ?? popup.parentElement ?? popup;
}

function fit(popup: HTMLElement) {
  popup.style.removeProperty("--popup-shift-x");
  popup.removeAttribute("data-placement");
  const result = fitPopup({
    popup: popup.getBoundingClientRect(),
    anchor: anchorOf(popup).getBoundingClientRect(),
    viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
  });
  if (result.shiftX) popup.style.setProperty("--popup-shift-x", `${result.shiftX}px`);
  if (result.placement) popup.setAttribute("data-placement", result.placement);
  popup.setAttribute("data-fitted", "");
}

function popupsIn(root: Element | null) {
  if (!root) return [];
  const own = root.matches("[data-popup]") ? [root as HTMLElement] : [];
  return [...own, ...root.querySelectorAll<HTMLElement>("[data-popup]")];
}

export function PopupFitter() {
  useEffect(() => {
    const onToggle = (event: Event) => {
      const details = event.target as HTMLDetailsElement;
      if (!(details instanceof HTMLDetailsElement)) return;
      for (const popup of details.querySelectorAll<HTMLElement>(":scope > [data-popup]")) {
        if (details.open) fit(popup);
        else popup.removeAttribute("data-fitted");
      }
    };
    const onEnter = (event: Event) => {
      const anchor = (event.target as Element | null)?.closest?.("[data-popup-anchor]");
      if (anchor) for (const popup of anchor.querySelectorAll<HTMLElement>("[data-popup]")) fit(popup);
    };
    const onResize = () => {
      for (const popup of document.querySelectorAll<HTMLElement>("[data-popup][data-fitted]")) fit(popup);
    };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) for (const popup of popupsIn(node)) fit(popup);
        }
      }
    });

    // toggle nebublá, proto zachytávání.
    document.addEventListener("toggle", onToggle, true);
    document.addEventListener("pointerover", onEnter);
    document.addEventListener("focusin", onEnter);
    window.addEventListener("resize", onResize);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("toggle", onToggle, true);
      document.removeEventListener("pointerover", onEnter);
      document.removeEventListener("focusin", onEnter);
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, []);
  return null;
}
