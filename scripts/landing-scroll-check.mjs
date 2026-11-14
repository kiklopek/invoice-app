// Production-only Chromium scroll profiling. Diagnostic overrides stay in the browser.
// Usage: node scripts/landing-scroll-check.mjs baseline [http://localhost:3100]
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const label = process.argv[2] || "baseline";
const origin = process.argv[3] || "http://localhost:3100";
const out = resolve("artifacts/landing-scroll", label);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chromium" });
const variants = process.env.SCROLL_VARIANTS?.split(",") || ["normal", "no-blur", "no-reveal", "no-countup"];
const widths = (process.env.SCROLL_WIDTHS || "1440,1920").split(",").map(Number);
const repeats = Number(process.env.SCROLL_REPEATS || 2);
const rows = [];

try {
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const width of widths) {
      // Alternate order to limit systematic warm-up / thermal bias.
      for (const variant of repeat % 2 ? [...variants].reverse() : variants) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
        let countupBypassed = false;
        await context.route("**/_next/static/**/*.js", async (route) => {
          const response = await route.fetch();
          let body = await response.text();
          if (variant === "no-countup" && body.includes("performance.now()>1200")) {
            body = body.replaceAll("performance.now()>1200", "performance.now()>-1");
            countupBypassed = true;
          }
          await route.fulfill({ response, body });
        });
        await context.addInitScript(({ variant }) => {
          window.__scrollMetrics = { frames: [], tasks: [], shifts: [] };
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) window.__scrollMetrics.tasks.push({ start: entry.startTime, duration: entry.duration });
          }).observe({ type: "longtask", buffered: true });
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__scrollMetrics.shifts.push({ start: entry.startTime, value: entry.value });
          }).observe({ type: "layout-shift", buffered: true });
          let previous;
          const tick = (now) => {
            if (previous !== undefined) window.__scrollMetrics.frames.push({ start: previous, duration: now - previous });
            previous = now;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          const install = () => {
            if (!document.documentElement) return;
            const style = document.createElement("style");
            style.textContent = variant === "no-blur"
              ? "header { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }"
              : variant === "single-scroll"
                ? "body { overflow-x: clip !important; }"
              : variant === "no-reveal"
                ? '[data-reveal], [data-reveal] * { transition: none !important; opacity: 1 !important; translate: none !important; rotate: none !important; stroke-dashoffset: 0 !important; }'
                : "";
            document.documentElement.append(style);
            observer.disconnect();
          };
          const observer = new MutationObserver(install);
          observer.observe(document, { childList: true, subtree: true });
          install();
        }, { variant });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const cdp = await context.newCDPSession(page);
        const events = [];
        cdp.on("Tracing.dataCollected", ({ value }) => events.push(...value));
        await cdp.send("Tracing.start", { categories: "devtools.timeline,blink.user_timing,cc,disabled-by-default-devtools.timeline.frame", transferMode: "ReportEvents" });
        await page.goto(origin, { waitUntil: "load" });
        await page.waitForFunction(() => document.documentElement.hasAttribute("data-motion"));
        if (variant === "no-countup") assert.ok(countupBypassed, "CountUp diagnostic must match the production bundle");
        const phases = [];
        for (const phase of ["first", "settled"]) {
          if (phase === "settled") await page.waitForTimeout(1000);
          const start = await page.evaluate((name) => { performance.mark(name); return performance.now(); }, `${phase}-start`);
          const distance = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
          const positions = [];
          for (const direction of [1, -1]) {
            for (let remaining = distance; remaining > 0; remaining -= 90) {
              await page.mouse.wheel(0, direction * Math.min(remaining, 90));
              await page.waitForTimeout(32);
            }
            await page.waitForTimeout(200);
            positions.push(await page.evaluate(() => ({ document: scrollY, body: document.body.scrollTop })));
          }
          const end = await page.evaluate((name) => { performance.mark(name); return performance.now(); }, `${phase}-end`);
          phases.push({ phase, start, end, positions });
        }
        const complete = new Promise((done) => cdp.once("Tracing.tracingComplete", done));
        await cdp.send("Tracing.end");
        await complete;
        const metrics = await page.evaluate(() => window.__scrollMetrics);
        const geometry = await page.evaluate(() => ({
          width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight, scrollY,
          header: document.querySelector("header").getBoundingClientRect().toJSON(),
          unrevealed: document.querySelectorAll("[data-reveal]:not([data-shown])").length,
        }));
        const name = `${width}-${variant}-${repeat}`;
        await writeFile(resolve(out, `${name}.trace.json.gz`), gzipSync(JSON.stringify({ traceEvents: events })));
        for (const { phase, start, end, positions } of phases) {
          const frames = metrics.frames.filter((f) => f.start >= start && f.start < end);
          const durations = frames.map((f) => f.duration).sort((a, b) => a - b);
          const t0 = events.find((e) => e.name === `${phase}-start`)?.ts;
          const t1 = events.find((e) => e.name === `${phase}-end`)?.ts;
          const traced = events.filter((e) => e.ts >= t0 && e.ts <= t1 && e.ph === "X");
          const totals = {};
          for (const type of ["Paint", "Layout", "UpdateLayoutTree", "RasterTask"]) {
            const selected = traced.filter((e) => e.name === type);
            totals[type] = { count: selected.length, ms: Math.round(selected.reduce((s, e) => s + (e.dur || 0), 0) / 1000) };
          }
          const row = {
            repeat, width, variant, phase, duration: Math.round(end - start), frames: frames.length,
            over33: durations.filter((d) => d > 33.4).length,
            over50: durations.filter((d) => d > 50).length,
            p95: Math.round(durations[Math.floor(durations.length * .95)] || 0),
            max: Math.round(durations.at(-1) || 0),
            longTasks: metrics.tasks.filter((e) => e.start >= start && e.start < end),
            cls: metrics.shifts.filter((e) => e.start >= start && e.start < end).reduce((sum, e) => sum + e.value, 0),
            totals, countupBypassed, geometry, positions, errors,
          };
          rows.push(row);
          console.log(JSON.stringify(row));
        }
        await writeFile(resolve(out, "results.json"), JSON.stringify(rows, null, 2));
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
