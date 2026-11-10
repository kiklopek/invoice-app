// Compare the original and fixed production servers, including native wheel gestures.
// Usage: node scripts/landing-scroll-browser-check.mjs http://localhost:3100 http://localhost:3101
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const origins = process.argv.slice(2);
assert.equal(origins.length, 2, "Supply the before and after production URLs.");
const out = resolve("artifacts/landing-scroll/browser");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chromium" });
const results = [];
try {
  for (const [index, origin] of origins.entries()) {
    const stage = index ? "after" : "before";
    for (const path of ["/", "/en"]) {
      for (const width of [1440, 1920, 390]) {
        for (const reducedMotion of ["no-preference", "reduce"]) {
          const context = await browser.newContext({
            viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion,
          });
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          const response = await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
          assert.equal(response.status(), 200);
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(2600);
          const topGeometry = await page.evaluate(() => ({
            sections: [...document.querySelectorAll("main > section, footer")].map((e) => ({
              id: e.id, x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y,
              width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height,
            })),
            width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
            bodyOverflow: getComputedStyle(document.body).overflowY,
            motion: document.documentElement.hasAttribute("data-motion"),
            headerHeight: document.querySelector("header").getBoundingClientRect().height,
          }));
          assert.ok(topGeometry.scrollWidth <= width, "No horizontal overflow");
          assert.equal(topGeometry.motion, reducedMotion !== "reduce");
          const name = `${stage}-${path === "/" ? "cs" : "en"}-${width}-${reducedMotion}`;
          await page.screenshot({ path: resolve(out, `${name}-top.png`) });

          const cdp = await context.newCDPSession(page);
          const gesture = async (distance) => {
            await cdp.send("Input.synthesizeScrollGesture", {
              x: Math.floor(width / 2), y: 450, yDistance: distance,
              speed: 1600, gestureSourceType: "mouse", preventFling: true,
            });
            return page.evaluate(() => ({
              document: scrollY, body: document.body.scrollTop,
              headerTop: document.querySelector("header").getBoundingClientRect().top,
            }));
          };
          const down = await gesture(-900);
          const up = await gesture(450);
          if (index) {
            assert.equal(topGeometry.bodyOverflow, "visible");
            assert.ok(down.document > 800, `Wheel gesture must reach document: ${JSON.stringify(down)}`);
            assert.equal(down.body, 0);
            assert.ok(Math.abs(down.headerTop) < 1, "Header stays sticky");
            assert.ok(down.document - up.document > 400, "Reverse gesture scrolls immediately");
          }
          // Reveal every section using document scrolling, then wait for the existing transitions.
          await page.evaluate(async () => {
            document.body.scrollTop = 0;
            for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * .65) {
              window.scrollTo({ top: y, behavior: "instant" });
              await new Promise((done) => setTimeout(done, 45));
            }
          });
          await page.waitForTimeout(1500);
          if (reducedMotion === "no-preference") {
            assert.equal(await page.locator("[data-reveal]:not([data-shown])").count(), 0);
          }
          assert.equal(await page.locator("[data-reveal]").evaluateAll((elements) =>
            elements.filter((element) => Number(getComputedStyle(element).opacity) < .99).length), 0,
          "All sections remain visible, including with reduced motion");
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
          await page.screenshot({ path: resolve(out, `${name}-full.png`), fullPage: true });
          // Exercise a real anchor link (desktop nav / mobile persona link).
          const href = width > 1080 ? "#jak-to-funguje" : "#cenik";
          const anchor = page.locator(`a[href="${href}"]:visible`).first();
          await anchor.click();
          await page.waitForTimeout(1100);
          const anchorResult = await page.evaluate((href) => ({
            hash: location.hash, top: document.querySelector(href).getBoundingClientRect().top,
          }), href);
          assert.equal(anchorResult.hash, href);
          assert.ok(Math.abs(anchorResult.top) < 250, "Anchor reaches its section");
          assert.deepEqual(errors, []);
          const row = { stage, path, width, reducedMotion, topGeometry, down, up, anchorResult, errors };
          results.push(row);
          await writeFile(resolve(out, "results.json"), JSON.stringify(results, null, 2));
          console.log(JSON.stringify({ stage, path, width, reducedMotion, down, up }));
          await context.close();
        }
      }
    }
  }
  for (const before of results.filter((r) => r.stage === "before")) {
    const after = results.find((r) => r.stage === "after" && r.path === before.path && r.width === before.width && r.reducedMotion === before.reducedMotion);
    assert.deepEqual(after.topGeometry.sections, before.topGeometry.sections, "Section layout must stay identical");
    assert.equal(after.topGeometry.headerHeight, before.topGeometry.headerHeight);
  }
  for (const path of ["/", "/en"]) {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 900 } });
    const page = await context.newPage();
    assert.equal((await page.goto(`${origins[1]}${path}`)).status(), 200);
    assert.equal(await page.locator("[data-reveal]").evaluateAll((elements) =>
      elements.filter((element) => Number(getComputedStyle(element).opacity) < .99).length), 0);
    await context.close();
  }
  console.log("PASS: layout comparison, wheel gestures, sticky header, anchors, motion and no-JavaScript rendering");
} finally {
  await browser.close();
}
