// Compare the actual pre-change working tree with the changed entry layouts.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit, expect } from "@playwright/test";
import { fixtures, NOW } from "./responsive-audit/fixtures.mjs";
import { startHarness, installNetwork } from "./responsive-audit/harness.mjs";

const out = resolve("artifacts/entry-layout-2026-11-02");
await mkdir(out, { recursive: true });
const engine = process.argv.includes("--engine=webkit") ? "webkit" : "chromium";
const live = process.argv.includes("--next");
const text = process.argv.includes("--text");
const curve = process.argv.includes("--curve");
const suffix = `${live ? "-next" : ""}${text ? "-text" : ""}${curve ? "-curve" : ""}`;
const browser = await { chromium, webkit }[engine].launch();
const cases = live
  ? ["login", "register"]
  : ["login", "register", "onboarding-1", "onboarding-7", "onboarding-8"];
const sizes = text
  ? [
      [390, 844],
      [1024, 768],
    ]
  : curve
    ? [
        [1599, 1120],
        [1600, 1120],
        [1601, 1120],
        [1920, 1080],
        [2400, 1120],
        [2560, 800],
        [2560, 900],
        [2560, 1120],
      ]
    : [
        [390, 844],
        [768, 1024],
        [1440, 900],
        [1920, 600],
        [2560, 1817],
        [3840, 2160],
      ];
const rows = [];
const signatures = new Map();
const stages = live ? ["next"] : ["before", "after"];
try {
  for (const stage of stages) {
    const source =
      stage === "before" ? "/tmp/splatno-entry-layout-before" : process.cwd();
    const harness = live
      ? null
      : await startHarness(source, `entry-layout-${engine}-${stage}`, 4380);
    try {
      for (const name of cases)
        for (const [width, height] of sizes) {
          const context = await browser.newContext({
            viewport: { width, height },
            locale: "cs-CZ",
            timezoneId: "Europe/Prague",
            reducedMotion: "reduce",
            hasTouch: width <= 768,
            isMobile: width <= 768,
          });
          const page = await context.newPage(),
            requests = [],
            errors = [];
          page.on("pageerror", (e) => errors.push(String(e)));
          const route = name.startsWith("onboarding")
            ? "/onboarding"
            : "/" + name;
          const data = await fixtures(process.cwd());
          if (name.startsWith("onboarding")) {
            const step = Number(name.split("-")[1]);
            data.onboardingDraft = {
              version: 1,
              step: Math.min(step, 7),
              reached: 7,
              updatedAt: Date.parse(NOW),
              company: {
                name: "Ukázková společnost s dlouhým názvem s.r.o.",
                ico: "",
                dic: "",
                registered_address: "Ukázková 123, Praha",
                operating_address: "",
                data_box_id: "",
                phone: "",
                email: "demo@example.invalid",
                bank_account_czk: "",
                bank_account_eur: "",
              },
              vatPayer: false,
              invites: [
                {
                  email: "velmi.dlouha.adresa.pro.overeni@example.invalid",
                  role: "accounting",
                },
              ],
              reminders: { days: [-3, 0, 7, 14], replyTo: "", ccText: "" },
              inviteEmail: "",
              inviteRole: "accounting",
              logo: null,
            };
            if (step === 8)
              data.onboardingPayment = {
                companyName: data.onboardingDraft.company.name,
                canManage: true,
                plan: null,
                period: null,
              };
          }
          await page.clock.setFixedTime(new Date(NOW));
          if (live) {
            await page.route("**/*", (route) => {
              const req = route.request(),
                url = new URL(req.url());
              if (
                !["localhost", "127.0.0.1"].includes(url.hostname) ||
                !["GET", "HEAD"].includes(req.method())
              )
                return route.abort();
              return route.continue();
            });
          } else {
            await page.addInitScript((d) => {
              window.__AUDIT_DATA__ = d;
            }, data);
            await installNetwork(page, data, "normal", requests);
            await page.route("**/api/onboarding/draft", (route) =>
              route.fulfill({ json: { draft: data.onboardingDraft } }),
            );
          }
          const result = {
            stage,
            engine,
            name,
            width,
            height,
            status: "failed",
          };
          try {
            await page.goto(
              (live ? "http://localhost:3000" : harness.url) + route,
              { waitUntil: "networkidle" },
            );
            await page.locator("h1").first().waitFor();
            await page.evaluate(() => document.fonts.ready);
            if (text)
              await page.evaluate(() => {
                // Measure first, then apply: avoid multiplying inherited text twice.
                const styles = [
                  ...document.querySelectorAll("main, main *"),
                ].map((el) => {
                  const style = getComputedStyle(el);
                  return {
                    el,
                    font: parseFloat(style.fontSize),
                    line: parseFloat(style.lineHeight),
                  };
                });
                for (const { el, font, line } of styles) {
                  el.style.fontSize = `${font * 2}px`;
                  if (Number.isFinite(line))
                    el.style.lineHeight = `${line * 2}px`;
                }
              });
            await expect(page.locator("[data-audit-error]")).toHaveCount(0);
            result.metrics = await page.evaluate(() => {
              const rect = (e) => {
                const r = e.getBoundingClientRect();
                return { x: r.x, y: r.y, width: r.width, height: r.height };
              };
              const visible = (e) => {
                const r = e.getBoundingClientRect();
                return (
                  r.width > 1 &&
                  r.height > 1 &&
                  getComputedStyle(e).visibility !== "hidden"
                );
              };
              const measure = (e) => ({
                rect: rect(e),
                font: parseFloat(getComputedStyle(e).fontSize),
                text: e.textContent?.trim().slice(0, 60),
              });
              const main = document.querySelector("main"),
                card = main.firstElementChild,
                h1 = document.querySelector("h1");
              return {
                card: rect(card),
                title: measure(h1),
                overflow: document.documentElement.scrollWidth > innerWidth + 1,
                bodyFont: parseFloat(getComputedStyle(main).fontSize),
                controls: [
                  ...document.querySelectorAll(
                    "input:not([type=checkbox]):not([type=radio]):not([type=file]),button[class*=primary]",
                  ),
                ]
                  .filter(visible)
                  .map(measure),
              };
            });
            expect(errors).toEqual([]);
            expect(result.metrics.overflow).toBe(false);
            const card = result.metrics.card;
            expect(Math.abs(card.x + card.width / 2 - width / 2)).toBeLessThan(
              1,
            );
            if (card.height < height - 2)
              expect(
                Math.abs(card.y + card.height / 2 - height / 2),
              ).toBeLessThan(1);
            for (const button of await page
              .locator("button[class*=primary]")
              .all())
              if (await button.isVisible()) {
                await button.scrollIntoViewIfNeeded();
                const box = await button.boundingBox();
                expect(box.x).toBeGreaterThanOrEqual(-1);
                expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
                expect(box.y).toBeGreaterThanOrEqual(-1);
                expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
              }
            await page.evaluate(() => {
              window.scrollTo(0, 0);
              for (const el of document.querySelectorAll("*"))
                if (el.scrollTop) el.scrollTop = 0;
            });
            const screenshot = `${engine}-${stage}${text ? "-text" : ""}${curve ? "-curve" : ""}-${name}-${width}x${height}.png`;
            const bytes = await page.screenshot({
              path: resolve(out, screenshot),
              fullPage: true,
              animations: "disabled",
            });
            result.screenshot = screenshot;
            const key = `${name}-${width}x${height}`;
            if (stage === "before")
              signatures.set(key, { metrics: result.metrics, bytes });
            if (stage === "after") {
              const baseline = signatures.get(key);
              if (width <= 1440) {
                expect(result.metrics).toEqual(baseline.metrics);
                expect(bytes.equals(baseline.bytes)).toBe(true);
                result.preservedBaselinePixels = true;
              }
              if (width >= 2560) {
                expect(
                  card.width / baseline.metrics.card.width,
                ).toBeGreaterThan(1.15);
                expect(card.width / baseline.metrics.card.width).toBeLessThan(
                  1.3,
                );
                expect(result.metrics.title.font).toBeLessThanOrEqual(54);
                for (const c of result.metrics.controls) {
                  expect(c.rect.height).toBeLessThanOrEqual(64);
                  expect(c.font).toBeLessThanOrEqual(18);
                }
                result.boundedGrowth = true;
              }
            }
            result.status = "passed";
          } catch (e) {
            result.failure = String(e);
            process.exitCode = 1;
          }
          rows.push(result);
          await writeFile(
            resolve(out, `results-${engine}${suffix}.json`),
            JSON.stringify(rows, null, 2),
          );
          console.log(
            `${engine} ${stage} ${name} ${width}x${height}: ${result.status}${result.failure ? " " + result.failure : ""}`,
          );
          await context.close();
          if (result.status !== "passed") throw new Error(result.failure);
        }
    } finally {
      await harness?.server.close();
    }
  }
} finally {
  await browser.close();
}
