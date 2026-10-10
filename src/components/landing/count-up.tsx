"use client";

import { useEffect, useRef } from "react";

const numberFormat = new Intl.NumberFormat("cs-CZ");

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

// Číslo v náhledu nástěnky, které při načtení naběhne od nuly. Server
// vyrenderuje cílovou hodnotu, takže bez JavaScriptu a při „omezit pohyb“
// je hned vidět finální číslo. Text se přepisuje přímo v DOM (bez re-renderu).
export function CountUp({
  value,
  delay = 0,
  duration = 1600,
  step = 1,
  suffix = "",
}: {
  value: number;
  delay?: number;
  duration?: number;
  step?: number;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (performance.now() > LATE_HYDRATION_MS) return;

    const render = (n: number) => {
      element.textContent = numberFormat.format(n) + suffix;
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
  }, [value, delay, duration, step, suffix]);

  return (
    <span ref={ref}>
      {numberFormat.format(value)}
      {suffix}
    </span>
  );
}
