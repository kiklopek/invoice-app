import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { chromium, webkit, expect } from "@playwright/test";
import { startHarness, installNetwork } from "./responsive-audit/harness.mjs";
import { fixtures, NOW } from "./responsive-audit/fixtures.mjs";

const engine = process.argv.includes("--engine=webkit") ? "webkit" : "chromium";
const smoke = process.argv.includes("--smoke");
const broad = process.argv.includes("--broad");
const reuseBefore = process.argv.includes("--reuse-before");
function navigationScale(width, height) {
  const growth = Math.max(0, (width - 1600) / 800);
  const widthProgress = growth / (1 + growth);
  const heightProgress = Math.max(0, Math.min(1, (height - 1000) / 800));
  return Math.min(
    1.85,
    1 + 0.75 * widthProgress + 0.7 * heightProgress * widthProgress,
  );
}
const out = resolve("artifacts/workspace-proportions-2026-11-02");
await mkdir(out, { recursive: true });
const browser = await { chromium, webkit }[engine].launch();
const rows = [],
  previous = new Map();
const resultFile = resolve(
  out,
  `results-${engine}${broad ? "-broad" : smoke ? "-smoke" : ""}.json`,
);
if (reuseBefore) {
  const saved = JSON.parse(await readFile(resultFile, "utf8")).filter(
    (row) => row.stage === "before" && row.status === "passed",
  );
  for (const row of saved) {
    rows.push(row);
    previous.set(`${row.route}-${row.width}x${row.height}`, {
      metrics: row.metrics,
      bytes: await readFile(resolve(out, row.screenshot)),
    });
  }
}
const routes = broad
  ? [
      "/customers",
      "/reminders",
      "/settings",
      "/invoices/detail",
      "/invoices/create",
      "/invoices/payments/archive",
      "/notifications",
      "/predplatne",
    ]
  : [
      "/dashboard",
      "/invoices",
      "/invoices/import",
      "/invoices/new",
      "/invoices/archive",
      "/invoices/payments",
      "/reports",
    ];
const sizes = broad
  ? [
      [2560, 1817],
      [1920, 600],
    ]
  : smoke
    ? [[2560, 1817]]
    : [
        [390, 844],
        [768, 1024],
        [1440, 900],
        [1920, 600],
        [2560, 1817],
        [3840, 2160],
      ];
try {
  for (const stage of reuseBefore ? ["after"] : ["before", "after"]) {
    const source =
      stage === "before"
        ? "/tmp/splatno-workspace-proportions-before"
        : process.cwd();
    const harness = await startHarness(
      source,
      `workspace-proportions-${engine}-${stage}`,
      engine === "webkit" ? 4383 : 4382,
    );
    try {
      for (const route of routes)
        for (const [width, height] of sizes) {
          const context = await browser.newContext({
            viewport: { width, height },
            locale: "cs-CZ",
            timezoneId: "Europe/Prague",
            reducedMotion: "reduce",
            hasTouch: width < 1000,
            isMobile: width < 1000,
          });
          const page = await context.newPage(),
            requests = [],
            errors = [];
          page.on("pageerror", (e) => errors.push(String(e)));
          const data = await fixtures(process.cwd());
          await page.clock.setFixedTime(new Date(NOW));
          await page.addInitScript((d) => {
            window.__AUDIT_DATA__ = d;
          }, data);
          await installNetwork(page, data, "normal", requests);
          const result = {
            stage,
            route,
            engine,
            width,
            height,
            status: "failed",
          };
          try {
            await page.goto(harness.url + route, { waitUntil: "networkidle" });
            await page.locator("h1").first().waitFor();
            await page.evaluate(() => document.fonts.ready);
            await expect(page.locator("[data-audit-error]")).toHaveCount(0);
            result.metrics = await page.evaluate(() => {
              const main = document.querySelector("main.content");
              const rect = (e) => {
                if (!e) return null;
                const r = e.getBoundingClientRect();
                return {
                  x: r.x,
                  y: r.y,
                  width: r.width,
                  height: r.height,
                  bottom: r.bottom,
                  right: r.right,
                };
              };
              const zoom = Number(getComputedStyle(main).zoom) || 1;
              const sidebar = document.querySelector("aside.sidebar");
              const donut = main.querySelector("[class*=_donut_]");
              const legend = main.querySelector("[class*=_statusLegend_]");
              const invoiceTable = main.querySelector(
                "[class*=_invoiceTable_] table",
              );
              const table = main.querySelector("table");
              const tableRows = table
                ? [...table.querySelectorAll("tbody tr")]
                : [];
              const pagination = main.querySelector("[class*=_pagination_]");
              const header = main.querySelector(
                "[class*=_stage_] > [class*=_header_]",
              );
              const upload = main.querySelector(".invoice-document-import");
              const plot = main.querySelector("[class*=_plot_]");
              return {
                main: rect(main),
                sidebar: rect(sidebar),
                zoom,
                overflow: document.documentElement.scrollWidth > innerWidth + 1,
                mainHeight: main.scrollHeight,
                headingFont:
                  parseFloat(
                    getComputedStyle(main.querySelector("h1")).fontSize,
                  ) * zoom,
                donut: rect(donut),
                legend: rect(legend),
                statusGap:
                  donut && legend
                    ? legend.getBoundingClientRect().x -
                      donut.getBoundingClientRect().right
                    : null,
                recentFont: invoiceTable
                  ? parseFloat(
                      getComputedStyle(invoiceTable.querySelector("td"))
                        .fontSize,
                    ) * zoom
                  : null,
                table: rect(table),
                rowHeights: tableRows.map(
                  (e) => e.getBoundingClientRect().height,
                ),
                footerGap:
                  tableRows.length && pagination
                    ? pagination.getBoundingClientRect().y -
                      tableRows.at(-1).getBoundingClientRect().bottom
                    : null,
                upload: rect(upload),
                header: rect(header),
                uploadHeaderGap:
                  upload && header
                    ? upload.getBoundingClientRect().y -
                      header.getBoundingClientRect().bottom
                    : null,
                manual: rect(main.querySelector(".manual-invoice-page")),
                plot: rect(plot),
                pageErrors: [],
              };
            });
            expect(errors).toEqual([]);
            expect(result.metrics.overflow).toBe(false);
            if (width >= 1024) {
              const scale =
                stage === "after" ? navigationScale(width, height) : 1;
              expect(
                Math.abs(result.metrics.sidebar.width - 244 * scale),
              ).toBeLessThan(1);
              expect(
                Math.abs(result.metrics.main.x - result.metrics.sidebar.right),
              ).toBeLessThan(1);
            }
            const screenshot = `${engine}-${stage}-${route.slice(1).replaceAll("/", "-")}-${width}x${height}.png`;
            const bytes = await page.screenshot({
              path: resolve(out, screenshot),
              fullPage: true,
              animations: "disabled",
            });
            result.screenshot = screenshot;
            const key = `${route}-${width}x${height}`;
            if (stage === "before")
              previous.set(key, { metrics: result.metrics, bytes });
            if (stage === "after") {
              const base = previous.get(key);
              if (width <= 1440) {
                expect(result.metrics).toEqual(base.metrics);
                const a = await sharp(bytes)
                  .ensureAlpha()
                  .raw()
                  .toBuffer({ resolveWithObject: true });
                const b = await sharp(base.bytes)
                  .ensureAlpha()
                  .raw()
                  .toBuffer({ resolveWithObject: true });
                expect(a.info.width).toBe(b.info.width);
                expect(a.info.height).toBe(b.info.height);
                let changed = 0;
                for (let i = 0; i < a.data.length; i += 4)
                  if (
                    a.data[i] !== b.data[i] ||
                    a.data[i + 1] !== b.data[i + 1] ||
                    a.data[i + 2] !== b.data[i + 2]
                  )
                    changed++;
                result.preservedPixels = bytes.equals(base.bytes);
                result.pixelNoiseRatio =
                  changed / (a.info.width * a.info.height);
                expect(result.pixelNoiseRatio).toBeLessThan(0.0001);
              }
              if (width === 2560) {
                if (route === "/dashboard") {
                  expect(result.metrics.statusGap).toBeLessThan(64);
                  expect(
                    result.metrics.donut.width / base.metrics.donut.width,
                  ).toBeGreaterThan(1.35);
                  expect(result.metrics.recentFont).toBeGreaterThanOrEqual(16);
                }
                if (route === "/invoices") {
                  expect(result.metrics.footerGap).toBeLessThan(56);
                  expect(Math.max(...result.metrics.rowHeights)).toBeLessThan(
                    120,
                  );
                }
                if (route === "/invoices/import")
                  expect(result.metrics.uploadHeaderGap).toBeLessThan(64);
                if (route === "/invoices/new")
                  expect(
                    result.metrics.manual.width / result.metrics.main.width,
                  ).toBeGreaterThan(0.65);
              }
              result.mainScaleStable = result.metrics.zoom <= 1.4;
              expect(result.mainScaleStable).toBe(true);
              if (width >= 1600) {
                const sidebar = page.locator("aside.sidebar");
                result.chrome = await sidebar.evaluate((el) => ({
                  scale: Number(getComputedStyle(el).zoom) || 1,
                  navFont: parseFloat(
                    getComputedStyle(el.querySelector(".nav-item-group > a"))
                      .fontSize,
                  ),
                  profileFont: parseFloat(
                    getComputedStyle(el.querySelector(".user-card strong"))
                      .fontSize,
                  ),
                }));
                expect(
                  Math.abs(
                    result.chrome.scale - navigationScale(width, height),
                  ),
                ).toBeLessThan(0.001);
                expect(result.chrome.scale).toBeGreaterThan(
                  result.metrics.zoom,
                );
                expect(
                  result.chrome.navFont * result.chrome.scale,
                ).toBeGreaterThan(15);
                await sidebar.locator(".user-card").scrollIntoViewIfNeeded();
                const profile = await sidebar
                  .locator(".user-card")
                  .boundingBox();
                expect(profile.y).toBeGreaterThanOrEqual(-1);
                expect(profile.y + profile.height).toBeLessThanOrEqual(
                  height + 1,
                );
              }
            }
            result.status = "passed";
          } catch (e) {
            result.failure = String(e);
            process.exitCode = 1;
            await page
              .screenshot({
                path: resolve(
                  out,
                  `${engine}-${stage}-${route.slice(1).replaceAll("/", "-")}-${width}-failed.png`,
                ),
                fullPage: true,
              })
              .catch(() => {});
          }
          result.requests = requests;
          result.errors = errors;
          rows.push(result);
          await writeFile(
            resolve(
              out,
              `results-${engine}${broad ? "-broad" : smoke ? "-smoke" : ""}.json`,
            ),
            JSON.stringify(rows, null, 2),
          );
          console.log(
            `${engine} ${stage} ${route} ${width}x${height}: ${result.status}${result.failure ? " " + result.failure : ""}`,
          );
          await context.close();
          if (result.status !== "passed") throw new Error(result.failure);
        }
    } finally {
      await harness.server.close();
    }
  }
} finally {
  await browser.close();
}
