// Measures (1) how centred the content of key "hero" panels is inside its box and
// (2) which elements are clipped by an ancestor (content cut off) at each size.
// Read-only: renders real components with synthetic data in the isolated harness.
//
//   node scripts/responsive-mockups/centering-clip-check.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { startHarness, installNetwork } from "../responsive-audit/harness.mjs";
import { fixtures, NOW } from "../responsive-audit/fixtures.mjs";

const ROUTES = (process.argv.find(a => a.startsWith("--routes="))?.slice(9).split(",")) || ["/invoices/payments", "/invoices/import", "/invoices", "/customers", "/dashboard", "/invoices/create"];
const SIZES = [[390, 844], [1024, 768], [1180, 820], [1470, 830], [1920, 1080], [2560, 1440]];
// Boxes whose content is meant to read as a centred block.
const PANELS = [".gpc-safety-card", ".gpc-dropzone", ".invoice-document-dropzone", "[class*=documentGuidance]", "[class*=_dropzone]", "[class*=_uploadPanel]"];

const out = resolve("artifacts/responsive-mockups/2026-11-07");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const harness = await startHarness(process.cwd(), "responsive-centering", 4392);
const rows = [];
try {
  for (const route of ROUTES)
    for (const [width, height] of SIZES) {
      const context = await browser.newContext({ viewport: { width, height }, locale: "cs-CZ", timezoneId: "Europe/Prague", reducedMotion: "reduce", hasTouch: width < 1000, isMobile: width < 1000 });
      const page = await context.newPage();
      const data = await fixtures(process.cwd());
      await page.clock.setFixedTime(new Date(NOW));
      await page.addInitScript((d) => { window.__AUDIT_DATA__ = d; }, data);
      await installNetwork(page, data, "normal", []);
      try {
        await page.goto(harness.url + route, { waitUntil: "networkidle" });
        await page.locator("h1").first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        const r = await page.evaluate((PANELS) => {
          const vis = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
          const panels = [];
          for (const sel of PANELS) for (const p of document.querySelectorAll(sel)) {
            if (!vis(p)) continue;
            const pb = p.getBoundingClientRect(), s = getComputedStyle(p);
            // union of visible leaf content (text + icons), padding excluded by definition
            let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
            const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
            const range = document.createRange();
            while (walker.nextNode()) { const n = walker.currentNode; if (!n.textContent.trim()) continue; range.selectNodeContents(n); for (const rc of range.getClientRects()) { if (!rc.width) continue; L = Math.min(L, rc.left); T = Math.min(T, rc.top); R = Math.max(R, rc.right); B = Math.max(B, rc.bottom); } }
            for (const e of p.querySelectorAll("svg, img, button, [class*=icon]")) { if (!vis(e)) continue; const b = e.getBoundingClientRect(); L = Math.min(L, b.left); T = Math.min(T, b.top); R = Math.max(R, b.right); B = Math.max(B, b.bottom); }
            if (L === Infinity) continue;
            const left = L - pb.left, right = pb.right - R, top = T - pb.top, bottom = pb.bottom - B;
            panels.push({ sel, box: { w: Math.round(pb.width), h: Math.round(pb.height) }, left: Math.round(left), right: Math.round(right), top: Math.round(top), bottom: Math.round(bottom),
              offX: Math.round((right - left) / 2), offY: Math.round((bottom - top) / 2), textAlign: s.textAlign, justify: s.justifyItems || s.justifyContent, align: s.alignContent || s.alignItems });
          }
          // clipped content: element whose content is wider/taller than an overflow-hidden/clip ancestor
          const clipped = [];
          for (const e of document.querySelectorAll("main *")) {
            if (!vis(e)) continue;
            const s = getComputedStyle(e);
            const clipsX = /hidden|clip/.test(s.overflowX), clipsY = /hidden|clip/.test(s.overflowY);
            if (!clipsX && !clipsY) continue;
            if (s.textOverflow === "ellipsis") continue; // intentional truncation with ellipsis
            const dx = e.scrollWidth - e.clientWidth, dy = e.scrollHeight - e.clientHeight;
            if ((clipsX && dx > 2) || (clipsY && dy > 2)) clipped.push({ el: e.tagName.toLowerCase() + "." + [...e.classList].slice(0, 2).join("."), text: (e.innerText || "").trim().slice(0, 40), hiddenX: clipsX ? dx : 0, hiddenY: clipsY ? dy : 0 });
          }
          return { panels, clipped: clipped.slice(0, 12), clippedCount: clipped.length, pageOverflowY: document.documentElement.scrollHeight - innerHeight, pageOverflowX: document.documentElement.scrollWidth - innerWidth };
        }, PANELS);
        rows.push({ route, width, height, ...r });
      } catch (error) { rows.push({ route, width, height, error: String(error).slice(0, 200) }); }
      await context.close();
    }
} finally {
  await writeFile(resolve(out, process.argv.includes("--routes=/invoices/import") ? "centering-import.json" : "centering-clip.json"), JSON.stringify(rows, null, 2));
  await harness.server.close();
  await browser.close();
}
console.log("written", rows.length);
