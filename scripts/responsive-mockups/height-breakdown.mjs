// Prints the vertical stack of a page's main content (top, height, margins, min-height)
// so overflow beyond the viewport can be attributed to concrete elements.
//   node scripts/responsive-mockups/height-breakdown.mjs /invoices/payments 1470x830 [depth]
import { chromium } from "@playwright/test";
import { startHarness, installNetwork } from "../responsive-audit/harness.mjs";
import { fixtures, NOW } from "../responsive-audit/fixtures.mjs";
const [route, size, depthArg] = process.argv.slice(2); const [w, h] = size.split("x").map(Number); const depth = Number(depthArg || 4);
const browser = await chromium.launch(); const hs = await startHarness(process.cwd(), "height", 4394);
const c = await browser.newContext({ viewport: { width: w, height: h }, locale: "cs-CZ", reducedMotion: "reduce" }); const p = await c.newPage();
const d = await fixtures(process.cwd()); await p.clock.setFixedTime(new Date(NOW)); await p.addInitScript(x => { window.__AUDIT_DATA__ = x; }, d); await installNetwork(p, d, "normal", []);
await p.goto(hs.url + route, { waitUntil: "networkidle" }); await p.evaluate(() => document.fonts.ready);
const rows = await p.evaluate((depth) => {
  const out = []; const main = document.querySelector("main.content") || document.querySelector("main");
  const zoom = Number(getComputedStyle(main).zoom) || 1;
  const walk = (e, lvl) => { if (lvl > depth) return; for (const k of e.children) { const s = getComputedStyle(k); if (s.display === "none" || s.position === "absolute" || s.position === "fixed") continue; const r = k.getBoundingClientRect(); if (r.height < 4) continue;
    out.push({ lvl, el: k.tagName.toLowerCase() + "." + [...k.classList].slice(0, 3).join("."), top: Math.round(r.top), h: Math.round(r.height), mt: s.marginTop, mb: s.marginBottom, pt: s.paddingTop, pb: s.paddingBottom, minH: s.minHeight, gap: s.rowGap, disp: s.display + (s.flexDirection === "column" ? "-col" : "") }); walk(k, lvl + 1); } };
  const ms = getComputedStyle(main), mr = main.getBoundingClientRect(); out.unshift({ lvl: 0, el: "MAIN " + main.className.slice(0, 50), top: Math.round(mr.top), h: Math.round(mr.height), mt: ms.marginTop, mb: ms.marginBottom, pt: ms.paddingTop, pb: ms.paddingBottom, minH: ms.minHeight, gap: ms.rowGap, disp: ms.display + (ms.flexDirection === "column" ? "-col" : "") + " h=" + ms.height });
  walk(main, 0); return { zoom, docH: document.documentElement.scrollHeight, vh: innerHeight, rows: out };
}, depth);
console.log(`zoom ${rows.zoom} docH ${rows.docH} viewport ${rows.vh} overflow ${rows.docH - rows.vh}`);
for (const r of rows.rows) console.log(`${"  ".repeat(r.lvl)}${r.el.slice(0, 60).padEnd(62 - 2 * r.lvl)} top ${String(r.top).padStart(4)} h ${String(r.h).padStart(4)}  m ${r.mt}/${r.mb} p ${r.pt}/${r.pb} min ${r.minH} gap ${r.gap} ${r.disp}`);
await hs.server.close(); await browser.close();
