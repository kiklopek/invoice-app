// Nabídky pod třemi tečkami se zavřou kliknutím mimo ně a otevřením jiné
// nabídky (light dismiss), v Chromium i WebKit, myší i dotykem.
//   node scripts/responsive-mockups/menu-dismiss-check.mjs
import { chromium, webkit } from "@playwright/test";
import { startHarness, installNetwork } from "../responsive-audit/harness.mjs";
import { fixtures, NOW } from "../responsive-audit/fixtures.mjs";

const scenarios = [
  { route: "/invoices", menus: ["summary[aria-label='Další akce faktur']"] },
  { route: "/dashboard", menus: ["summary[aria-label^='Akce faktury'] >> nth=0", "summary[aria-label^='Akce faktury'] >> nth=-1"] },
  { route: "/invoices/create", menus: ["summary[aria-label^='Akce položky'] >> nth=0", "summary[aria-label='Další možnosti vystavení']"] },
  { route: "/predplatne", menus: ["summary[aria-label='Možnosti předplatného']"] },
];
const harness = await startHarness(process.cwd(), "menu-dismiss", 4398);
const data = await fixtures(process.cwd());
const problems = [];
let checked = 0;
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  for (const touch of [false, true]) {
    const width = touch ? 390 : 1470, height = touch ? 844 : 830;
    for (const s of scenarios) {
      const context = await browser.newContext({ viewport: { width, height }, locale: "cs-CZ", timezoneId: "Europe/Prague", reducedMotion: "reduce", hasTouch: touch, isMobile: touch && engine === chromium });
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date(NOW));
      await page.addInitScript((d) => { window.__AUDIT_DATA__ = d; }, data);
      await installNetwork(page, data, "normal", []);
      await page.goto(harness.url + s.route, { waitUntil: "networkidle" });
      await page.locator("h1").first().waitFor();
      const label = `${engine.name()} ${touch ? "touch" : "mouse"} ${s.route}`;
      const tap = async (locator) => { await locator.scrollIntoViewIfNeeded(); if (touch) await locator.tap(); else await locator.click(); };
      const isOpen = (locator) => locator.evaluate((el) => el.parentElement.open);
      const present = [];
      for (const selector of s.menus) if (await page.locator(selector).isVisible().catch(() => false)) present.push(page.locator(selector));
      if (!present.length) { console.log(`${label}: nabídka na této šířce není vidět, přeskočeno`); await context.close(); continue; }
      if (!present.length) { problems.push(`${label}: nabídka nenalezena`); await context.close(); continue; }
      // 1. Klik mimo nabídku ji zavře.
      await tap(present[0]);
      if (!(await isOpen(present[0]))) problems.push(`${label}: nabídka se neotevřela`);
      // Prázdné místo stránky: levý horní roh obsahu (bez tlačítek).
      const spot = await page.evaluate(() => {
        const main = document.querySelector("main")?.getBoundingClientRect();
        for (const [x, y] of [[main ? main.left + 3 : 3, main ? Math.max(main.top, 0) + 3 : 3], [innerWidth - 3, innerHeight - 3], [innerWidth / 2, innerHeight - 3]]) {
          const el = document.elementFromPoint(x, y);
          if (el && !el.closest("a, button, summary, input, select, textarea, label, [data-popup], details[open]")) return { x, y };
        }
        return null;
      });
      if (!spot) problems.push(`${label}: nenašlo se prázdné místo pro klik`);
      else if (touch) await page.touchscreen.tap(spot.x, spot.y); else await page.mouse.click(spot.x, spot.y);
      if (await isOpen(present[0])) problems.push(`${label}: klik mimo nabídku ji nezavřel`);
      checked++;
      // 2. Otevření druhé nabídky zavře první.
      if (present[1]) {
        await tap(present[0]);
        await tap(present[1]);
        if (await isOpen(present[0])) problems.push(`${label}: otevření jiné nabídky nezavřelo první`);
        if (!(await isOpen(present[1]))) problems.push(`${label}: druhá nabídka se neotevřela`);
        checked++;
      }
      // 3. Klik dovnitř nabídky ji nezavře, Escape ano.
      await tap(present[0]);
      await present[0].evaluate((summary) => summary.parentElement.querySelector(":scope > [data-popup]").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
      if (!(await isOpen(present[0]))) problems.push(`${label}: klik dovnitř nabídku zavřel`);
      await page.keyboard.press("Escape");
      if (await isOpen(present[0])) problems.push(`${label}: Escape nabídku nezavřel`);
      checked++;
      await context.close();
    }
  }
  await browser.close();
}
await harness.stop?.();
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log(`Menus OK: ${checked} kontrol (klik mimo, jiná nabídka, klik dovnitř, Escape) v Chromium a WebKit.`);
process.exit(0);
