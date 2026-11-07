import { resolve } from "node:path";
import { chromium } from "@playwright/test";
// Element screenshot helper: node scripts/responsive-mockups/panel-shot.mjs <route> <selector> 1470x830 ...
const root = process.cwd();
const { startHarness, installNetwork } = await import(resolve(root, "scripts/responsive-audit/harness.mjs"));
const { fixtures, NOW } = await import(resolve(root, "scripts/responsive-audit/fixtures.mjs"));
const [route, sel, ...sizes] = process.argv.slice(2);
const browser = await chromium.launch(); const h = await startHarness(root, "shot", 4393);
for (const s of sizes) { const [w, ht] = s.split("x").map(Number);
  const c = await browser.newContext({ viewport: { width: w, height: ht }, locale: "cs-CZ", reducedMotion: "reduce" }); const p = await c.newPage();
  const d = await fixtures(root); await p.clock.setFixedTime(new Date(NOW)); await p.addInitScript(x => { window.__AUDIT_DATA__ = x; }, d); await installNetwork(p, d, "normal", []);
  await p.goto(h.url + route, { waitUntil: "networkidle" }); await p.evaluate(() => document.fonts.ready);
  await p.locator(sel).first().screenshot({ path: `${process.env.OUT || "artifacts/responsive-mockups/2026-11-07"}/${route.replaceAll("/","_")}-${s}.png` }); await c.close(); }
await h.server.close(); await browser.close();
