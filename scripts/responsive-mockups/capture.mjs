// Captures the two design pillars (mobile 390×844, MacBook Air 13" 1470×830)
// and the current state at the target mockup sizes for the five key pages.
// Real components, synthetic data, isolated Vite harness. Changes nothing in src/.
//
//   node scripts/responsive-mockups/capture.mjs [--engine=webkit] [--only=/dashboard]
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit } from "@playwright/test";
import { startHarness, installNetwork } from "../responsive-audit/harness.mjs";
import { fixtures, NOW } from "../responsive-audit/fixtures.mjs";

const engine = process.argv.includes("--engine=webkit") ? "webkit" : "chromium";
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

export const PAGES = [
  { route: "/dashboard", name: "dashboard", label: "Dashboard" },
  { route: "/invoices", name: "invoices", label: "Seznam faktur" },
  { route: "/customers", name: "customers", label: "Zákazníci" },
  { route: "/invoices/create", name: "invoice-create", label: "Tvorba faktury" },
  { route: "/invoices/payments", name: "payments", label: "Platby" },
];
export const SIZES = [
  { id: "mobile", width: 390, height: 844, role: "pillar", touch: true },
  { id: "tablet-1024", width: 1024, height: 768, role: "target", touch: true },
  { id: "tablet-1180", width: 1180, height: 820, role: "target", touch: true },
  { id: "macbook", width: 1470, height: 830, role: "pillar", touch: false },
  { id: "large-1920", width: 1920, height: 1080, role: "target", touch: false },
  { id: "large-2560", width: 2560, height: 1440, role: "target", touch: false },
];

const out = resolve("artifacts/responsive-mockups/2026-11-07", engine);
await mkdir(out, { recursive: true });
const browser = await { chromium, webkit }[engine].launch();
const harness = await startHarness(
  process.cwd(),
  `responsive-mockups-${engine}`,
  engine === "webkit" ? 4391 : 4390,
);
const rows = [];
try {
  for (const pageDef of PAGES.filter((p) => !only || p.route === only))
    for (const size of SIZES) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        locale: "cs-CZ",
        timezoneId: "Europe/Prague",
        reducedMotion: "reduce",
        hasTouch: size.touch,
        // Mobile emulation only below the desktop shell, matching existing checks.
        isMobile: size.width < 1000 && engine === "chromium",
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      const data = await fixtures(process.cwd());
      await page.clock.setFixedTime(new Date(NOW));
      await page.addInitScript((d) => {
        window.__AUDIT_DATA__ = d;
      }, data);
      await installNetwork(page, data, "normal", []);
      const row = { page: pageDef.name, size: size.id, ...size, status: "failed" };
      try {
        await page.goto(harness.url + pageDef.route, { waitUntil: "networkidle" });
        await page.locator("h1").first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        row.metrics = await page.evaluate(measure);
        const file = `${pageDef.name}--${size.id}-${size.width}x${size.height}.png`;
        await page.screenshot({ path: resolve(out, file), fullPage: true });
        row.screenshot = file;
        row.errors = errors;
        row.status = errors.length ? "errors" : "ok";
      } catch (error) {
        row.error = String(error).slice(0, 400);
      }
      rows.push(row);
      console.log(`${row.status.padEnd(6)} ${pageDef.name} ${size.id}`);
      await context.close();
    }
} finally {
  await writeFile(resolve(out, "capture.json"), JSON.stringify(rows, null, 2));
  await harness.server.close();
  await browser.close();
}

// Geometry anchors used to calibrate Figma frames against the pillars.
function measure() {
  const main = document.querySelector("main.content") || document.querySelector("main");
  const zoom = Number(getComputedStyle(main).zoom) || 1;
  const rect = (e) => {
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const font = (e) => (e ? Math.round(parseFloat(getComputedStyle(e).fontSize) * zoom * 10) / 10 : null);
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
  };
  const table = [...main.querySelectorAll("table")].find(visible);
  const firstRow = table?.querySelector("tbody tr");
  const kpis = [...main.querySelectorAll("[class*=kpi i], [class*=Kpi], [class*=metric i]")]
    .filter(visible)
    .map(rect);
  const kpiRows = new Set(kpis.map((k) => k.y)).size;
  return {
    viewport: { w: innerWidth, h: innerHeight },
    zoom,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    documentHeight: document.documentElement.scrollHeight,
    sidebar: rect([...document.querySelectorAll("aside.sidebar, aside")].find(visible)),
    mobileHeader: rect(document.querySelector("[class*=mobileHeader], header.mobile-header")),
    main: rect(main),
    h1: { ...rect(main.querySelector("h1")), font: font(main.querySelector("h1")) },
    table: table
      ? {
          ...rect(table),
          columns: table.querySelectorAll("thead th").length,
          rowHeight: firstRow ? Math.round(firstRow.getBoundingClientRect().height) : null,
          cellFont: font(table.querySelector("td")),
          scrollsLocally: table.parentElement.scrollWidth > table.parentElement.clientWidth + 1,
        }
      : null,
    kpiCount: kpis.length,
    kpiRows,
    bodyFont: font(main.querySelector("p, td, label")),
  };
}
