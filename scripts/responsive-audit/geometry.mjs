import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit } from "@playwright/test";
import { fixtures, NOW } from "./fixtures.mjs";
import { startHarness, installNetwork } from "./harness.mjs";
const source = "/tmp/splatno-responsive-production-26defdc",
  out = resolve("artifacts/responsive-audit/2026-11-02/geometry");
await mkdir(out, { recursive: true });
const h = await startHarness(source, "geometry", 4377),
  results = [];
const routes = [
  "/dashboard",
  "/invoices",
  "/invoices/create",
  "/invoices/import",
  "/invoices/payments",
  "/reports",
];
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      for (const route of routes)
        for (const [width, height] of [
          [1024, 600],
          [1280, 600],
          [1280, 720],
          [1440, 800],
          [2560, 600],
          [1440, 900],
        ]) {
          const context = await browser.newContext({
              viewport: { width, height },
              locale: "cs-CZ",
              timezoneId: "Europe/Prague",
              reducedMotion: "reduce",
            }),
            page = await context.newPage(),
            requests = [];
          await page.clock.setFixedTime(new Date(NOW));
          await page.addInitScript(
            (d) => (window.__AUDIT_DATA__ = d),
            await fixtures(source),
          );
          await installNetwork(
            page,
            await fixtures(source),
            "normal",
            requests,
          );
          const row = { engine: engine.name(), route, width, height };
          try {
            await page.goto(h.url + route);
            await page.locator("h1").first().waitFor();
            await page.evaluate(() => document.fonts.ready);
            row.metrics = await page.evaluate(() => {
              const box = (n) =>
                n
                  ? {
                      x: n.getBoundingClientRect().x,
                      y: n.getBoundingClientRect().y,
                      width: n.getBoundingClientRect().width,
                      height: n.getBoundingClientRect().height,
                      bottom: n.getBoundingClientRect().bottom,
                    }
                  : null;
              const sidebar = document.querySelector(".sidebar"),
                bottom = document.querySelector(".sidebar-bottom"),
                h = document.querySelector("h1");
              const controls = [
                ...document.querySelectorAll(
                  "main input:not([type=hidden]),main select,main button",
                ),
              ]
                .filter((n) => {
                  const r = n.getBoundingClientRect();
                  return (
                    r.width >= 24 &&
                    r.height >= 24 &&
                    getComputedStyle(n).visibility !== "hidden" &&
                    !n.closest("[aria-hidden=true]")
                  );
                })
                .slice(0, 18)
                .map((n) => ({
                  tag: n.tagName,
                  label:
                    n.getAttribute("aria-label") ||
                    n.getAttribute("placeholder") ||
                    n.textContent.trim().slice(0, 45),
                  font: parseFloat(getComputedStyle(n).fontSize),
                  height: n.getBoundingClientRect().height,
                  width: n.getBoundingClientRect().width,
                }));
              return {
                overflow: document.documentElement.scrollWidth > innerWidth + 1,
                sidebar: box(sidebar),
                sidebarBottom: box(bottom),
                sidebarScrollHeight: sidebar?.scrollHeight,
                sidebarOverflowY:
                  sidebar && getComputedStyle(sidebar).overflowY,
                headingFont: h && parseFloat(getComputedStyle(h).fontSize),
                controls,
                mainHeight: document
                  .querySelector("main")
                  .getBoundingClientRect().height,
                viewportHeight: innerHeight,
              };
            });
            row.status = "measured";
            if (width === 1280 && height === 600) {
              row.screenshot = `${engine.name()}-${route.slice(1).replaceAll("/", "-")}-${width}x${height}.png`;
              await page.screenshot({
                path: resolve(out, row.screenshot),
                fullPage: true,
              });
            }
          } catch (e) {
            row.status = "unverified";
            row.failure = String(e).slice(0, 400);
          }
          results.push(row);
          await writeFile(
            resolve(out, "results.json"),
            JSON.stringify(results, null, 2),
          );
          await context.close();
          console.log(
            `${engine.name()} ${route} ${width}x${height}: ${row.status}`,
          );
        }
    } finally {
      await browser.close();
    }
  }
} finally {
  await h.server.close();
}
