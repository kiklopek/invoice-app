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
  // Alignment (rule 13): measured deviations in px.
  await page.evaluate(() => window.scrollTo(0, 0));
  r.align = await page.evaluate(() => {
    const R = (e) => e.getBoundingClientRect();
    const textBox = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); const rs = [...rg.getClientRects(), ...[...e.querySelectorAll("svg, img, .ini, .pill, .amt")].map(R)].filter((x) => x.width); if (!rs.length) return R(e); return { left: Math.min(...rs.map((x) => x.left)), right: Math.max(...rs.map((x) => x.right)), top: Math.min(...rs.map((x) => x.top)), bottom: Math.max(...rs.map((x) => x.bottom)) }; };
    let header = 0;
    for (const th of document.querySelectorAll(".thead")) {
      const panel = th.parentElement; const row = [...panel.querySelectorAll(".rows .row")].find((x) => x.style.display !== "none"); if (!row) continue;
      [...th.children].forEach((h, k) => { const c = row.children[k]; if (!c || !h.textContent.trim()) return; const right = getComputedStyle(h).textAlign === "right";
        const hb = textBox(h), cb = textBox(c); header = Math.max(header, Math.abs(right ? hb.right - cb.right : hb.left - cb.left)); });
    }
    let cards = 0;
    for (const g of document.querySelectorAll(".kpis, .grid2, .split, .editor")) { const ks = [...g.children].filter((x) => x.offsetParent && x.classList.contains("card")); if (ks.length < 2 || g.classList.contains("editor")) continue; const t = ks.map((k) => R(k).top), b = ks.map((k) => R(k).bottom); cards = Math.max(cards, Math.max(...t) - Math.min(...t), Math.max(...b) - Math.min(...b)); }
    let navIcon = 0;
    for (const a of document.querySelectorAll(".nav.side > a:not(.sub):not(.esko)")) { const ic = a.querySelector(".ic"); const tx = [...a.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()); if (!ic || !tx) continue; const rg = document.createRange(); rg.selectNodeContents(tx); const t = rg.getBoundingClientRect(); const c = R(ic); navIcon = Math.max(navIcon, Math.abs((c.top + c.bottom) / 2 - (t.top + t.bottom) / 2)); }
    const logo = document.querySelector(".nav .logo"), top = document.querySelector(".top");
    const logoTop = logo && top ? Math.abs((R(logo).top + R(logo).bottom) / 2 - (R(top).top + R(top).bottom) / 2) : null;
    const fill = document.querySelector("[data-nav-fill]");
    let columns = 0;
    for (const box of document.querySelectorAll(".rows")) { const rows = [...box.children].filter((x) => x.style.display !== "none"); if (rows.length < 2) continue; const n = rows[0].children.length;
      for (let k = 0; k < n; k++) { const ls = rows.map((r) => r.children[k] && R(r.children[k]).left).filter((x) => x != null); columns = Math.max(columns, Math.max(...ls) - Math.min(...ls)); } }
    return { columns: Math.round(columns), header: Math.round(header), cards: Math.round(cards), navIcon: Math.round(navIcon * 10) / 10, logoVsTopbar: logoTop == null ? null : Math.round(logoTop), navGap: fill ? Math.round(R(fill).height) : null };
  });
  results.push({ file: f, ...r });
  await page.close();
}
await browser.close();
await writeFile(resolve(SHOTS, "verify.json"), JSON.stringify(results, null, 2));
for (const r of results) console.log(`${r.file.padEnd(32)} ${r.scrolls ? "scroll-ok " : "static    "} overflow ${String(r.docOverflow).padStart(4)}  gap-below ${String(r.gapBelowContent).padStart(4)}  rows ${r.rows.map((x) => x.kept + "(+" + x.leftover + ")").join(" ") || "-"}  align ${JSON.stringify(r.align)}  brokenText ${r.brokenCount}  boxOverflow ${r.overflowingBoxes.length}${r.overflowingBoxes.length ? " " + JSON.stringify(r.overflowingBoxes) : ""}${r.brokenCount ? " " + JSON.stringify(r.broken.slice(0, 2)) : ""}`);
