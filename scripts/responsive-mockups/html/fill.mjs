// Measures how much of each scalable card its content block uses (rule 15): fill ratio per
// axis and the largest empty margin, so objects grow as well as shrink and leave no big gaps.
//   node scripts/responsive-mockups/html/fill.mjs [file-filter]
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
const DIR = resolve("docs/responsive/mockups");
const filter = process.argv[2] || "";
const files = (await readdir(DIR)).filter((f) => /-\d+x\d+\.html$/.test(f) && f.includes(filter)).sort();
const browser = await chromium.launch();
for (const f of files) {
  const [w, h] = f.match(/(\d+)x(\d+)/).slice(1).map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(pathToFileURL(resolve(DIR, f)).href); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(150);
  const out = await page.evaluate(() => [...document.querySelectorAll("[data-scale]")].map((card) => {
    const c = card.getBoundingClientRect(), cs = getComputedStyle(card);
    const inner = { l: c.left + parseFloat(cs.paddingLeft), r: c.right - parseFloat(cs.paddingRight), t: c.top + parseFloat(cs.paddingTop), b: c.bottom - parseFloat(cs.paddingBottom) };
    const body = card.querySelector("[data-scale-body]") || card;
    const ib = body.getBoundingClientRect();
    let L = Infinity, R = -Infinity, T = Infinity, B = -Infinity;
    const take = (r) => { if (!r.width || !r.height) return; L = Math.min(L, r.left); R = Math.max(R, r.right); T = Math.min(T, r.top); B = Math.max(B, r.bottom); };
    const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT); const rg = document.createRange();
    while (w.nextNode()) { if (!w.currentNode.textContent.trim()) continue; rg.selectNodeContents(w.currentNode); [...rg.getClientRects()].forEach(take); }
    body.querySelectorAll("svg, img, .donut, .kpi-ic, .bar .stack").forEach((e) => take(e.getBoundingClientRect()));
    const area = { l: Math.max(inner.l, ib.left), r: Math.min(inner.r, ib.right), t: Math.max(inner.t, ib.top), b: Math.min(inner.b, ib.bottom) };
    const W = area.r - area.l, H = area.b - area.t;
    const gaps = { left: L - area.l, right: area.r - R, top: T - area.t, bottom: area.b - B };
    return { card: card.dataset.scale, box: `${Math.round(W)}×${Math.round(H)}`, fillX: +((R - L) / W).toFixed(2), fillY: +((B - T) / H).toFixed(2), maxGap: Math.round(Math.max(...Object.values(gaps))), gaps: Object.fromEntries(Object.entries(gaps).map(([k, v]) => [k, Math.round(v)])) };
  }));
  for (const o of out) console.log(`${f.padEnd(26)} ${o.card.padEnd(10)} box ${o.box.padEnd(9)} fillX ${String(o.fillX).padEnd(4)} fillY ${String(o.fillY).padEnd(4)} maxGap ${String(o.maxGap).padStart(4)}  ${JSON.stringify(o.gaps)}`);
  await page.close();
}
await browser.close();
