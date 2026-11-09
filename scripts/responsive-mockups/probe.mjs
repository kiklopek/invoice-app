// Evaluates a JS expression on a page at given sizes and prints the JSON result.
//   node scripts/responsive-mockups/probe.mjs /invoices/payments "expr" 1470x830 390x844
import { chromium } from "@playwright/test";
import { startHarness, installNetwork } from "../responsive-audit/harness.mjs";
import { fixtures, NOW } from "../responsive-audit/fixtures.mjs";
const [route, expr, ...sizes] = process.argv.slice(2);
const browser = await chromium.launch(); const hs = await startHarness(process.cwd(), "probe", 4396);
for (const s of sizes) { const [w, h] = s.split("x").map(Number);
  const c = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 1000, hasTouch: w < 1000 }); const p = await c.newPage();
  const d = await fixtures(process.cwd()); await p.clock.setFixedTime(new Date(NOW)); await p.addInitScript(x => { window.__AUDIT_DATA__ = x; }, d); await installNetwork(p, d, "normal", []);
  await p.goto(hs.url + route, { waitUntil: "networkidle" }); await p.evaluate(() => document.fonts.ready);
  console.log(s, JSON.stringify(await p.evaluate(expr))); await c.close(); }
await hs.server.close(); await browser.close();
