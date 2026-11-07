// Browser check of the invoice detail pane (TRANSITION_RULES pravidlo 11):
// from 2200 px a row click selects the invoice into the pane and does not navigate;
// below that the pane is absent and a click opens the invoice as before.
//   node scripts/responsive-mockups/detail-pane-check.mjs
import { chromium } from "@playwright/test";
import { startHarness, installNetwork } from "../responsive-audit/harness.mjs";
import { fixtures, NOW } from "../responsive-audit/fixtures.mjs";

const browser = await chromium.launch();
const harness = await startHarness(process.cwd(), "detail-pane", 4398);
const data = await fixtures(process.cwd());
const failures = [];
const check = (ok, message) => { console.log(`${ok ? "✓" : "✗"} ${message}`); if (!ok) failures.push(message); };
try {
  for (const [width, height, pane] of [[2560, 1440, true], [2200, 1200, true], [1920, 1080, false], [1470, 830, false]]) {
    const context = await browser.newContext({ viewport: { width, height }, locale: "cs-CZ", timezoneId: "Europe/Prague" });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(NOW));
    await page.addInitScript((d) => { window.__AUDIT_DATA__ = d; }, data);
    await installNetwork(page, data, "normal", []);
    await page.goto(harness.url + "/invoices", { waitUntil: "networkidle" });
    const aside = page.locator("aside[aria-label^='Detail faktury']");
    check((await aside.isVisible().catch(() => false)) === pane, `${width}: pane ${pane ? "shown" : "hidden"}`);
    const row = page.locator("tbody tr").nth(2);
    const number = (await row.locator("td:nth-child(2) a").textContent()).trim();
    await row.locator("td:nth-child(3)").click();
    const navigated = await page.evaluate(() => window.__AUDIT_NAVIGATION__ ?? null);
    if (pane) {
      check(navigated === null, `${width}: click selects without navigating`);
      check((await aside.getAttribute("aria-label")) === `Detail faktury ${number}`, `${width}: pane shows ${number}`);
      check(await row.evaluate((tr) => tr.hasAttribute("data-selected")), `${width}: clicked row is highlighted`);
      const box = await aside.boundingBox();
      check(box.y + box.height <= height + 1 && box.width === 400, `${width}: pane is 400 px and inside the window (${Math.round(box.width)}×${Math.round(box.height)})`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no horizontal overflow`);
    } else {
      check(typeof navigated === "string" && navigated.startsWith("/invoices/"), `${width}: click opens the invoice (${navigated})`);
    }
    await context.close();
  }
} finally {
  await harness.server.close();
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failure(s)` : "\nDetail pane OK");
process.exit(failures.length ? 1 : 0);
