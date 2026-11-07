import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit } from "@playwright/test";
import { fixtures, NOW } from "./fixtures.mjs";
import { startHarness, installNetwork } from "./harness.mjs";
const source = "/tmp/splatno-responsive-production-26defdc",
  out = resolve("artifacts/responsive-audit/2026-11-02/repeatability");
await mkdir(out, { recursive: true });
const h = await startHarness(source, "repeatability", 4378),
  results = [];
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      for (const route of ["/dashboard", "/invoices", "/invoices/import"])
        for (const width of [390, 1440, 2560]) {
          const height = width === 390 ? 844 : width === 1440 ? 900 : 1440,
            context = await browser.newContext({
              viewport: { width, height },
              locale: "cs-CZ",
              timezoneId: "Europe/Prague",
              reducedMotion: "reduce",
            }),
            page = await context.newPage();
          const data = await fixtures(source);
          await page.clock.setFixedTime(new Date(NOW));
          await page.addInitScript((d) => (window.__AUDIT_DATA__ = d), data);
          await installNetwork(page, data, "normal", []);
          await page.goto(h.url + route);
          await page.locator("h1").first().waitFor();
          await page.evaluate(() => document.fonts.ready);
          await page.waitForLoadState("networkidle");
          const options = {
              fullPage: true,
              animations: "disabled",
              caret: "hide",
            },
            first = await page.screenshot(options),
            second = await page.screenshot(options);
          const name = `${engine.name()}-${route.slice(1).replaceAll("/", "-")}-${width}`,
            equal = first.equals(second);
          await writeFile(resolve(out, name + "-candidate.png"), second);
          if (!equal) await writeFile(resolve(out, name + "-first.png"), first);
          results.push({
            engine: engine.name(),
            route,
            width,
            height,
            consecutivePngBytesEqual: equal,
            scope:
              "same mounted page, stable data/time/fonts; not a cross-run or approved design baseline",
          });
          await writeFile(
            resolve(out, "results.json"),
            JSON.stringify(results, null, 2),
          );
          await context.close();
          console.log(`${name}: ${equal ? "stable" : "DIFF"}`);
        }
    } finally {
      await browser.close();
    }
  }
} finally {
  await h.server.close();
}
