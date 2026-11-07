// Verifies the HTML prototypes against the transition rules and screenshots them.
//   node scripts/responsive-mockups/html/verify.mjs
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const DIR = resolve("docs/responsive/mockups");
const SHOTS = resolve("artifacts/responsive-mockups/2026-11-07/html");
await mkdir(SHOTS, { recursive: true });
const files = (await readdir(DIR)).filter((f) => /-\d+x\d+\.html$/.test(f)).sort();
const browser = await chromium.launch();
const results = [];
for (const f of files) {
  const [w, h] = f.match(/(\d+)x(\d+)/).slice(1).map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(pathToFileURL(resolve(DIR, f)).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => {
    const scrolls = document.body.classList.contains("scrolls");
    const main = document.querySelector(".main").getBoundingClientRect();
    // bottom of the last direct child of main = where content ends
    const kids = [...document.querySelector(".main").children];
    const contentBottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom));
    // text overflowing its box without an ellipsis = broken (rules 7-8)
    const broken = [];
    for (const e of document.querySelectorAll(".main *")) {
      if (!e.childNodes.length || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const s = getComputedStyle(e); if (s.display === "none") continue;
      const over = e.scrollWidth - e.clientWidth;
      if (over > 1 && s.textOverflow !== "ellipsis") broken.push({ el: e.className || e.tagName, text: e.textContent.trim().slice(0, 30), over });
    }
    // overlaps between siblings in grid/flex rows (text drawn over neighbours)
    const rows = [...document.querySelectorAll(".rows[data-fit]")].map((b) => { const vis = [...b.children].filter((c) => c.style.display !== "none"); const used = vis.reduce((a, c) => a + c.getBoundingClientRect().height, 0); return { kept: vis.length, leftover: Math.round(b.clientHeight - used) }; });
    return { scrolls, docOverflow: document.documentElement.scrollHeight - innerHeight, gapBelowContent: Math.round(innerHeight - contentBottom), mainBottomPad: Math.round(innerHeight - main.bottom), broken: broken.slice(0, 6), brokenCount: broken.length, rows };
  });
  // Scrolling pages: shoot the window at the top and scrolled to the end, so sticky parts
  // (navigation, preview) are shown where the user actually sees them.
  await page.screenshot({ path: resolve(SHOTS, f.replace(".html", ".png")) });
  if (r.scrolls) { await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(100); await page.screenshot({ path: resolve(SHOTS, f.replace(".html", "-end.png")) }); }
  // Any element wider than its parent inside a card = overflowing control (buttons, pills).
  r.overflowingBoxes = await page.evaluate(() => [...document.querySelectorAll(".card *")].filter((e) => { const p = e.parentElement; if (!p || getComputedStyle(p).overflow !== "visible") return false; const a = e.getBoundingClientRect(), b = p.getBoundingClientRect(); return a.width > 0 && (a.right > b.right + 1 || a.left < b.left - 1); }).slice(0, 5).map((e) => (e.className.baseVal ?? e.className) + " " + (e.textContent || "").trim().slice(0, 24)));
  results.push({ file: f, ...r });
  await page.close();
}
await browser.close();
await writeFile(resolve(SHOTS, "verify.json"), JSON.stringify(results, null, 2));
for (const r of results) console.log(`${r.file.padEnd(32)} ${r.scrolls ? "scroll-ok " : "static    "} overflow ${String(r.docOverflow).padStart(4)}  gap-below ${String(r.gapBelowContent).padStart(4)}  rows ${r.rows.map((x) => x.kept + "(+" + x.leftover + ")").join(" ") || "-"}  brokenText ${r.brokenCount}  boxOverflow ${r.overflowingBoxes.length}${r.overflowingBoxes.length ? " " + JSON.stringify(r.overflowingBoxes) : ""}${r.brokenCount ? " " + JSON.stringify(r.broken.slice(0, 2)) : ""}`);
