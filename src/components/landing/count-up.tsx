"use client";

import { useEffect, useRef } from "react";
import { formatCzk, formatNumber } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";

// Po této době od načtení stránky už hero animace doběhla a uživatel číslo
// viděl; pozdní hydratace ho pak nemá znovu shazovat na nulu.
const LATE_HYDRATION_MS = 1200;

/**
 * Hodnota ve snímku animace: ease-out quart (rychlý start, dlouhý pozvolný
 * dojezd). Během počítání se zaokrouhluje na `step`, aby u velkých částek
 * neblikaly poslední číslice; na konci vždy přesně cíl.
 */
export function countUpValue(target: number, progress: number, step = 1) {
  const t = Math.min(1, Math.max(0, progress));
  if (t === 1) return target;
  return Math.round((target * (1 - (1 - t) ** 4)) / step) * step;
}

function display(locale: Locale, currency: boolean, n: number) {
  return currency ? formatCzk(locale, n) : formatNumber(locale, n);
}

// Číslo v náhledu nástěnky, které při načtení naběhne od nuly. Server
// vyrenderuje cílovou hodnotu, takže bez JavaScriptu a při „omezit pohyb“
// je hned vidět finální číslo. Text se přepisuje přímo v DOM (bez re-renderu).
export function CountUp({
  value,
  delay = 0,
  duration = 1600,
  step = 1,
  locale,
  currency = false,
}: {
  value: number;
  delay?: number;
  duration?: number;
  step?: number;
  locale: Locale;
  /** Částka v korunách („1 340 000 Kč“ / „CZK 1,340,000“). */
  currency?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (performance.now() > LATE_HYDRATION_MS) return;

    const render = (n: number) => {
      element.textContent = display(locale, currency, n);
    };
    let frame = 0;
    render(0);
    const timer = window.setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const progress = (now - start) / duration;
        render(countUpValue(value, progress, step));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, delay);

    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      render(value);
    };
  }, [value, delay, duration, step, locale, currency]);

  return <span ref={ref}>{display(locale, currency, value)}</span>;
}
