// Per-page layout health at any size: horizontal overflow, page scroll, empty space
// below the content, clipped text and the zoom in effect. Prints one row per page.
//   node scripts/responsive-mockups/page-metrics.mjs 1920x1080 2560x1440 [--only=/invoices] [--shots=dir]
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { startHarness, installNetwork } from "../responsive-audit/harness.mjs";
import { fixtures, NOW } from "../responsive-audit/fixtures.mjs";

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const sizes = process.argv.slice(2).filter((a) => /^\d+x\d+$/.test(a));
const routes = arg("only")?.split(",") ?? [
  "/dashboard", "/invoices", "/invoices/detail", "/invoices/new", "/invoices/create",
  "/invoices/import", "/invoices/payments", "/invoices/archive", "/invoices/payments/archive",
  "/customers", "/reminders", "/reports", "/settings", "/notifications", "/predplatne",
];
const shots = arg("shots");
if (shots) await mkdir(resolve(shots), { recursive: true });

const browser = await chromium.launch();
const harness = await startHarness(process.cwd(), "page-metrics", 4394);
const data = await fixtures(process.cwd());
console.log("size       route                        hOver vScroll gapBelow clipped zoom  bodyText");
for (const s of sizes) {
  const [width, height] = s.split("x").map(Number);
  for (const route of routes) {
    const context = await browser.newContext({ viewport: { width, height }, locale: "cs-CZ", timezoneId: "Europe/Prague", reducedMotion: "reduce", isMobile: width < 1000, hasTouch: width < 1000 });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(NOW));
    await page.addInitScript((d) => { window.__AUDIT_DATA__ = d; }, data);
    await installNetwork(page, data, "normal", []);
    await page.goto(harness.url + route, { waitUntil: "networkidle" });
    await page.locator("h1").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(() => {
      const main = document.querySelector("main") ?? document.body;
      const scroller = document.scrollingElement;
      // Lowest painted box inside main (ignores invisible and fixed elements).
      // Each box is clipped by its nearest clipping ancestors, so content inside an
      // inner scroller does not count as reaching below the window.
      const srOnly = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width <= 2 || r.height <= 2 || cs.clipPath.startsWith("inset(50%") || cs.clip.startsWith("rect(0"); };
      const visibleBottom = (el) => { let b = el.getBoundingClientRect().bottom; for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflowY !== "visible" || cs.overflowX !== "visible") b = Math.min(b, a.getBoundingClientRect().bottom); } return b; };
      let bottom = 0;
      for (const el of main.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (cs.position === "fixed" || cs.visibility === "hidden" || cs.display === "none" || srOnly(el)) continue;
        if (cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.borderBottomWidth !== "0px" || el.children.length === 0) bottom = Math.max(bottom, visibleBottom(el) + scroller.scrollTop);
      }
      // Text cut off without an ellipsis (rule 7).
      const clipped = [...main.querySelectorAll("*")].filter((el) => {
        if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false;
        const cs = getComputedStyle(el);
        if (cs.textOverflow === "ellipsis" || cs.display === "none" || srOnly(el) || el.closest("svg, [hidden], [aria-hidden='true']")) return false;
        const clips = cs.overflowX !== "visible" || cs.overflowY !== "visible";
        return clips && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2);
      }).map((el) => el.textContent.trim().slice(0, 30));
      const sample = main.querySelector("td, p, li") ?? main;
      return {
        hOver: scroller.scrollWidth - innerWidth,
        vScroll: scroller.scrollHeight - innerHeight,
        gapBelow: scroller.scrollHeight - innerHeight > 2 ? 0 : Math.round(innerHeight - bottom),
        clipped,
        zoom: getComputedStyle(main).zoom,
        text: getComputedStyle(sample).fontSize,
      };
    });
    console.log(`${s.padEnd(10)} ${route.padEnd(28)} ${String(m.hOver).padStart(5)} ${String(m.vScroll).padStart(7)} ${String(m.gapBelow).padStart(8)} ${String(m.clipped.length).padStart(7)} ${String(m.zoom).slice(0, 5).padStart(5)} ${m.text}${m.clipped.length ? "  ← " + m.clipped.slice(0, 3).join(" | ") : ""}`);
    if (shots) await page.screenshot({ path: resolve(shots, `${route.slice(1).replaceAll("/", "_")}--${s}.png`) });
    await context.close();
  }
}
await harness.server.close();
await browser.close();
