"use client";

import { useEffect } from "react";

// Jemné animace landing page při scrollu. Prvky s atributem data-reveal se
// skryjí až tady (html[data-motion]), takže bez JavaScriptu a při
// „omezit pohyb“ je stránka hned celá vidět. Každý prvek se ukáže jednou
// (data-shown) a pak se přestane sledovat.
export function LandingMotion() {
  useEffect(() => {
    const root = document.documentElement;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute("data-shown", "");
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });

    const targets = document.querySelectorAll("[data-reveal]");
    targets.forEach((element) => observer.observe(element));
    root.setAttribute("data-motion", "");

    return () => {
      observer.disconnect();
      root.removeAttribute("data-motion");
    };
  }, []);
  return null;
}
