"use client";

import { useEffect } from "react";

// Jemné animace landing page při scrollu. Prvky s atributem data-reveal se
// skryjí až tady (html[data-motion]), takže bez JavaScriptu a při
// „omezit pohyb“ je stránka hned celá vidět. Každý prvek se ukáže jednou
// (data-shown) a pak se přestane sledovat.
export function LandingMotion() {
  useEffect(() => {
    const root = document.documentElement;
    if (!("IntersectionObserver" in window)) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let observer: IntersectionObserver | undefined;

    const updateMotion = () => {
      observer?.disconnect();
      root.removeAttribute("data-motion");
      if (preference.matches) return;

      const nextObserver = new IntersectionObserver((entries, activeObserver) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-shown", "");
          activeObserver.unobserve(entry.target);
        }
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });

      observer = nextObserver;
      document.querySelectorAll("[data-reveal]:not([data-shown])").forEach((element) => nextObserver.observe(element));
      root.setAttribute("data-motion", "");
    };
    updateMotion();
    preference.addEventListener("change", updateMotion);

    return () => {
      preference.removeEventListener("change", updateMotion);
      observer?.disconnect();
      root.removeAttribute("data-motion");
    };
  }, []);
  return null;
}
