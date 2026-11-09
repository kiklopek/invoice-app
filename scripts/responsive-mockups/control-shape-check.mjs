// Small controls keep their shape at every size, with a mouse and on touch screens
// (TRANSITION_RULES pravidlo 9): a switch stays a track (wider than tall),
// checkboxes and radios stay square, icons keep their aspect ratio and size.
// Touch rules may enlarge the hit area, never the drawn control.
//   node scripts/responsive-mockups/control-shape-check.mjs [--sizes=1024x768,1920x1080] [--only=/invoices/detail]
import { chromium } from "@playwright/test";
import { startHarness, installNetwork } from "../responsive-audit/harness.mjs";
import { fixtures, NOW } from "../responsive-audit/fixtures.mjs";

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const sizes = (arg("sizes")?.split(",") ?? ["390x844", "1024x768", "1470x830", "1920x1080", "2560x1440"]).map((s) => s.split("x").map(Number));
const routes = arg("only")?.split(",") ?? [
  "/dashboard", "/invoices", "/invoices/detail", "/invoices/new", "/invoices/create",
  "/invoices/import", "/invoices/payments", "/invoices/archive", "/invoices/payments/archive",
  "/customers", "/reminders", "/reports", "/settings", "/notifications", "/predplatne",
];

const browser = await chromium.launch();
const harness = await startHarness(process.cwd(), "control-shape", 4399);
const data = await fixtures(process.cwd());
const problems = [];
let checked = 0;
for (const [width, height] of sizes) {
  for (const touch of [false, true]) {
    for (const route of routes) {
      const context = await browser.newContext({ viewport: { width, height }, locale: "cs-CZ", timezoneId: "Europe/Prague", reducedMotion: "reduce", hasTouch: touch, isMobile: touch && width < 1000 });
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date(NOW));
      await page.addInitScript((d) => { window.__AUDIT_DATA__ = d; }, data);
      await installNetwork(page, data, "normal", []);
      await page.goto(harness.url + route, { waitUntil: "networkidle" });
      await page.locator("h1").first().waitFor();
      const found = await page.evaluate(() => {
        const out = [];
        const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.opacity !== "0"; };
        const name = (el) => (el.getAttribute("aria-label") || el.closest("label")?.textContent || el.className?.baseVal || el.className || el.tagName).toString().trim().slice(0, 40);
        const box = (el) => el.getBoundingClientRect();
        for (const el of document.querySelectorAll("main [role=switch], body > div [role=switch]")) {
          if (!visible(el)) continue;
          const r = box(el);
          out.push({ kind: "switch", name: name(el), w: r.width, h: r.height, bad: r.width < r.height * 1.4 && el.textContent.trim() === "" });
        }
        for (const el of document.querySelectorAll('main input:is([type=checkbox],[type=radio])')) {
          if (!visible(el) || getComputedStyle(el).appearance === "none" && el.getBoundingClientRect().width < 4) continue;
          const r = box(el);
          // A checkbox drawn as a switch (appearance: none, wider than tall) is a track.
          if (getComputedStyle(el).appearance === "none" && r.width > r.height * 1.2)
            out.push({ kind: "switch", name: name(el), w: r.width, h: r.height, bad: r.width < r.height * 1.4 });
          // A native checkbox (appearance: auto) is always drawn square in the
          // middle of its box (checked in Chromium and WebKit), so a taller box is
          // only a touch area. A custom-drawn one must itself be square.
          else if (getComputedStyle(el).appearance === "none")
            out.push({ kind: el.type, name: name(el), w: r.width, h: r.height, bad: Math.abs(r.width - r.height) > 1.5 });
          else out.push({ kind: el.type, name: name(el), w: r.width, h: r.height, bad: r.width < 8 });
        }
        for (const el of document.querySelectorAll("main svg")) {
          // Screen-reader-only controls (1 px boxes) are not drawn.
          const srOnly = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const q = x.getBoundingClientRect(); if (q.width <= 2 || q.height <= 2) return true; } return false; };
          if (!visible(el) || srOnly(el) || el.closest("[data-chart], .recharts-wrapper, [class*=chart], [class*=Chart], [class*=donut], [class*=Donut]")) continue;
          const vb = el.viewBox?.baseVal;
          if (!vb || !vb.width || !vb.height || vb.width > 32 || vb.height > 32) continue; // icons only
          const r = box(el);
          const want = vb.width / vb.height, got = r.width / r.height;
          out.push({ kind: "icon", name: name(el.parentElement), w: r.width, h: r.height, bad: Math.abs(got - want) > 0.08 || r.width < 8 });
        }
        return out;
      });
      checked += found.length;
      for (const f of found.filter((x) => x.bad))
        problems.push(`${route} ${width}x${height}${touch ? " touch" : ""}: ${f.kind} "${f.name}" ${Math.round(f.w)}x${Math.round(f.h)}`);
      await context.close();
    }
  }
}
await browser.close();
await harness.stop?.();
const unique = [...new Set(problems)];
if (unique.length) {
  console.error(`${unique.length} control(s) out of shape (${checked} checked):`);
  for (const p of unique) console.error("- " + p);
  process.exit(1);
}
console.log(`Controls OK: ${checked} switches, checkboxes and icons keep their shape.`);
process.exit(0);
