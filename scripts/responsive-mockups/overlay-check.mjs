// Opens every common overlay (menus, popovers, dialogs, search results, panels) on
// its real page at each size and measures it against docs/responsive/handoff/05
// (I-R01 space, I-R03 not clipped, I-R07 no text overflow, I-R10 touch targets).
//   node scripts/responsive-mockups/overlay-check.mjs [--sizes=390x844,...] [--only=search,...] [--shots=dir]
// Prints one line per scenario × size; exits 1 when an overlay leaves the window,
// is clipped, or overflows its text.
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { startHarness, installNetwork } from "../responsive-audit/harness.mjs";
import { fixtures, NOW } from "../responsive-audit/fixtures.mjs";

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const SIZES = (arg("sizes")?.split(",") ?? ["320x568", "390x844", "768x1024", "1024x600", "1024x768", "1470x830", "1920x1080", "2560x1440", "3840x2160"])
  .map((s) => s.split("x").map(Number));
const only = arg("only")?.split(",");
const shots = arg("shots");
if (shots) await mkdir(resolve(shots), { recursive: true });

const click = (name, role = "button") => async (p) => p.getByRole(role, { name, exact: false }).first().click();
const summary = (text) => async (p) => { const s = p.locator(`summary[aria-label*="${text}"]`).or(p.locator("summary", { hasText: text })).first(); await s.scrollIntoViewIfNeeded(); await s.click(); if (process.env.DEBUG) console.log("details open:", await s.evaluate((el) => [el.parentElement.open, el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30)])); };
// Search results the harness does not serve: short and long titles, all three kinds.
const SEARCH = { unavailable: [], results: [
  { id: "1", type: "invoice", title: "FV-2026-0001", subtitle: "Ukázkový odběratel 1 s.r.o. · 125 000,00 Kč", href: "/invoices/1" },
  { id: "2", type: "customer", title: "Ukázkový odběratel s velmi dlouhým obchodním názvem a.s.", subtitle: "IČO 12345678 · kontakt1@example.invalid", href: "/customers" },
  { id: "3", type: "payment", title: "Platba 266 189,00 Kč", subtitle: "VS 1443260143 · 20. 10. 2026", href: "/invoices/payments" },
  { id: "4", type: "invoice", title: "260612", subtitle: "Ukázkový odběratel 2 s.r.o. · 15 730,00 Kč", href: "/invoices/2" },
] };
const typeSearch = (selector) => async (p) => {
  await p.route("**/api/search?*", (r) => r.fulfill({ json: SEARCH }));
  const i = p.locator(selector).first(); await i.scrollIntoViewIfNeeded(); await i.click(); await i.fill(""); await i.fill("Ukáz"); await p.waitForTimeout(800);
};
const desktop = (w) => w >= 1024;
const SCENARIOS = [
  { id: "search", route: "/invoices", when: desktop, open: typeSearch("[data-workspace-topbar] input") },
  { id: "notifications", route: "/invoices", when: desktop, open: summary("Oznámení") },
  { id: "row-actions-first", route: "/invoices", when: desktop, open: async (p) => p.locator("tbody button[aria-label^='Akce faktury']").first().click() },
  { id: "row-actions-last", route: "/invoices", when: desktop, open: async (p) => { const b = p.locator("tbody button[aria-label^='Akce faktury']").last(); await b.scrollIntoViewIfNeeded(); await b.click(); } },
  { id: "invoices-page-menu", route: "/invoices", when: desktop, open: summary("Další akce faktur") },
  { id: "payment-confirm", route: "/invoices", when: desktop, open: async (p) => { await p.locator("tbody button[aria-label^='Akce faktury']").first().click(); await p.getByRole("button", { name: "Potvrdit úhradu" }).first().click(); } },
  { id: "dashboard-chart-settings", route: "/dashboard", when: desktop, open: summary("Nastavení grafu") },
  { id: "dashboard-row-actions-last", route: "/dashboard", when: desktop, open: async (p) => { const s = p.locator("summary[aria-label^='Akce faktury']").last(); await s.scrollIntoViewIfNeeded(); await s.click(); } },
  { id: "detail-actions", route: "/invoices/detail", when: () => true, open: summary("Další akce s fakturou") },
  { id: "create-item-actions", route: "/invoices/create", when: () => true, open: async (p) => { const s = p.locator("summary[aria-label^='Akce položky']").first(); await s.scrollIntoViewIfNeeded(); await s.click(); } },
  { id: "create-more-options", route: "/invoices/create", when: () => true, open: summary("Další možnosti vystavení") },
  { id: "create-customer-search", route: "/invoices/create", when: () => true, open: async (p) => { const i = p.locator("main input:not([type=hidden])").filter({ hasNot: p.locator("[data-workspace-topbar]") }).and(p.locator(":not([data-workspace-topbar] input)")).first(); await i.scrollIntoViewIfNeeded(); await i.click(); await i.fill("Ukáz"); await p.waitForTimeout(800); } },
  { id: "reports-export", route: "/reports", when: () => true, open: click("Exportovat") },
  { id: "subscription-menu", route: "/predplatne", when: () => true, open: summary("Možnosti předplatného") },
  { id: "esko", route: "/dashboard", when: desktop, open: async (p) => p.locator(".sidebar button[aria-haspopup=dialog]").first().click() },
  // Phones and portrait tablets (below 1024 px the mobile shell is used).
  { id: "m-navigation", route: "/invoices", when: (w) => w < 1024, open: click("Otevřít navigaci") },
  { id: "m-search", route: "/invoices", when: (w) => w < 768, open: async (p) => { await p.route("**/api/search?*", (r) => r.fulfill({ json: SEARCH })); await click("Otevřít vyhledávání")(p); await p.waitForTimeout(300); await p.keyboard.type("Ukáz"); await p.waitForTimeout(800); } },
  { id: "m-account", route: "/invoices", when: (w) => w < 768, open: click("Otevřít účet a firmu") },
  { id: "m-invoice-filters", route: "/invoices", when: (w) => w < 768, open: click("Filtry faktur") },
  { id: "m-row-actions", route: "/invoices", when: (w) => w < 1024, open: async (p) => p.locator("button[aria-label^='Akce faktury']").first().click() },
  { id: "m-notifications", route: "/invoices", when: (w) => w < 1024, target: "details[open] section", open: summary("Oznámení") },
  { id: "m-reports-period", route: "/reports", when: (w) => w < 768, open: click("Vybrat období") },
  { id: "m-reports-filters", route: "/reports", when: (w) => w < 768, open: click("Otevřít filtry") },
  { id: "m-esko", route: "/dashboard", when: (w) => w < 1024, open: async (p) => { await click("Otevřít navigaci")(p); await p.waitForTimeout(300); await p.getByRole("button", { name: "Esko" }).last().click(); } },
  // Confirmations on the invoice detail (all sizes).
  // Smazat jde jen koncept bez úhrady a odeslané upomínky (fáze F1b), proto
  // tenhle scénář dostane takovou fakturu.
  { id: "detail-delete-confirm", route: "/invoices/detail", when: () => true,
    data: (d) => ({ ...d, detail: { ...d.detail, invoice: { ...d.detail.invoice, paid_amount: 0, reminders_sent: 0, status: "pending", money_evidence: null } } }), open: async (p) => { const b = p.getByRole("button", { name: "Smazat fakturu" }).first(); if (!(await b.isVisible())) await summary("Další akce s fakturou")(p); await b.click(); } },
  { id: "reports-more-filters", route: "/reports", when: desktop, inline: true, open: summary("Další filtry") },
].filter((s) => !only || only.includes(s.id));

// Everything that can be an overlay; the newly visible ones after the trigger are measured.
const CANDIDATES = "dialog[open], [role=dialog], [role=listbox], [role=menu], [role=tooltip], [data-popup], details[open] > :not(summary)";

const browser = await chromium.launch();
const harness = await startHarness(process.cwd(), "overlay-check", 4399);
const data = await fixtures(process.cwd());
const failures = [];
console.log("scenario                     size        box (x,y,w,h)            margin  clip over  font  small scroll");
for (const s of SCENARIOS)
  for (const [width, height] of SIZES) {
    if (!s.when(width)) continue;
    const touch = width <= 1180;
    const context = await browser.newContext({ viewport: { width, height }, locale: "cs-CZ", timezoneId: "Europe/Prague", reducedMotion: "reduce", hasTouch: touch, isMobile: width < 1000 });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(NOW));
    const scenarioData = s.data ? s.data(data) : data;
    await page.addInitScript((d) => { window.__AUDIT_DATA__ = d; }, scenarioData);
    await installNetwork(page, scenarioData, "normal", []);
    let line = `${s.id.padEnd(28)} ${`${width}x${height}`.padEnd(11)} `;
    try {
      await page.goto(harness.url + s.route, { waitUntil: "networkidle" });
      await page.locator("h1").first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate((sel) => { window.__before = new Set([...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden" && !e.closest("details:not([open])"))); }, CANDIDATES);
      await s.open(page);
      await page.waitForTimeout(250);
      const m = await page.evaluate(({ sel, touch, target }) => {
        const visible = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden" && getComputedStyle(e).display !== "none" && !e.closest("details:not([open])") && !e.closest("dialog:not([open])");
        let fresh = target ? [...document.querySelectorAll(target)].filter(visible) : [...document.querySelectorAll(sel)].filter((e) => visible(e) && !window.__before.has(e));
        fresh = fresh.filter((e) => !fresh.some((o) => o !== e && o.contains(e)));
        if (!fresh.length) return null;
        const o = fresh.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
        const r = o.getBoundingClientRect();
        const margin = Math.round(Math.min(r.left, r.top, innerWidth - r.right, innerHeight - r.bottom));
        // Clipped: a point just inside each corner must hit the overlay itself.
        // Inset past the rounded corner (a point at 0.3 r from the corner is inside the curve).
        const t = Math.max(6, Math.ceil(0.3 * (parseFloat(getComputedStyle(o).borderTopLeftRadius) || 0)) + 2);
        const pts = [[r.left + t, r.top + t], [r.right - t, r.top + t], [r.left + t, Math.min(r.bottom, innerHeight) - t], [r.right - t, Math.min(r.bottom, innerHeight) - t]];
        const clip = pts.filter(([x, y]) => { const hit = document.elementFromPoint(x, y); return !hit || !(o === hit || o.contains(hit)); }).length;
        const over = [...o.querySelectorAll("*")].filter((e) => { if (!visible(e) || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false; const cs = getComputedStyle(e); const box = e.getBoundingClientRect(); if (box.width <= 2 || box.height <= 2) return false; /* screen-reader-only text */ return cs.textOverflow !== "ellipsis" && cs.overflowX !== "visible" && e.scrollWidth > e.clientWidth + 1; }).map((e) => e.textContent.trim().slice(0, 24));
        const textEl = [...o.querySelectorAll("a, button, li, p, span, label, strong")].find((e) => visible(e) && e.textContent.trim());
        // A checkbox or radio is hit through its label, so the label is the target.
        const hitArea = (e) => (e.matches("input[type=checkbox], input[type=radio]") && e.closest("label")) || e;
        const small = touch ? [...o.querySelectorAll("a, button, input, select, summary, [role=option]")].filter((e) => visible(e) && hitArea(e).getBoundingClientRect().height < 44 && e.getBoundingClientRect().width > 0).length : 0;
        return { tag: o.tagName.toLowerCase() + (o.getAttribute("role") ? `[${o.getAttribute("role")}]` : ""), box: [r.left, r.top, r.width, r.height].map(Math.round), margin, clip, over, font: textEl ? getComputedStyle(textEl).fontSize : "-", small, scroll: o.scrollHeight > o.clientHeight + 1 ? "yes" : "" };
      }, { sel: CANDIDATES, touch, target: s.target ?? null });
      if (!m) { line += "no overlay found"; failures.push(`${s.id} ${width}x${height}: no overlay`); }
      else {
        line += `${m.box.join(",").padEnd(24)} ${String(m.margin).padStart(6)} ${String(m.clip).padStart(5)} ${String(m.over.length).padStart(4)} ${m.font.padStart(6)} ${String(m.small).padStart(5)} ${m.scroll.padStart(6)}  ${m.tag}`;
        if (m.margin < 0) failures.push(`${s.id} ${width}x${height}: leaves the window by ${-m.margin}px`);
        if (m.clip) failures.push(`${s.id} ${width}x${height}: ${m.clip} corner(s) covered or clipped`);
        if (m.over.length) failures.push(`${s.id} ${width}x${height}: text overflow ${m.over.slice(0, 3).join(" | ")}`);
      }
      if (shots) await page.screenshot({ path: resolve(shots, `${s.id}--${width}x${height}.png`) });
      if (m && !s.inline) {
        // Keyboard (WCAG 2.1.1, 2.4.3): Escape closes the overlay and focus stays on or returns to its trigger.
        const opener = await page.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? (a.getAttribute("aria-label") || a.textContent || a.tagName).trim().slice(0, 30) : null; });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        const after = await page.evaluate((sel) => {
          const visible = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden" && getComputedStyle(e).display !== "none" && !e.closest("details:not([open])") && !e.closest("dialog:not([open])");
          const still = [...document.querySelectorAll(sel)].filter((e) => visible(e) && !window.__before.has(e)).length;
          const a = document.activeElement;
          return { still, focus: a && a !== document.body ? (a.getAttribute("aria-label") || a.textContent || a.tagName).trim().slice(0, 30) : "body" };
        }, CANDIDATES);
        line += `  esc:${after.still ? "OPEN" : "closed"} focus:${after.focus === "body" ? "LOST" : "ok"}`;
        if (after.still) failures.push(`${s.id} ${width}x${height}: Escape does not close it`);
        if (after.focus === "body") failures.push(`${s.id} ${width}x${height}: focus lost after Escape (opener ${opener})`);
      }
      if (m && !s.inline && !s.keepOnOutside) {
        // Klik vedle (light dismiss): okno se znovu otevře a klikne se na
        // neaktivní místo stránky mimo okno i jeho tlačítko; okno se musí zavřít.
        await s.open(page);
        await page.waitForTimeout(250);
        const point = await page.evaluate((sel) => {
          const visible = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden" && getComputedStyle(e).display !== "none" && !e.closest("details:not([open])") && !e.closest("dialog:not([open])");
          const open = [...document.querySelectorAll(sel)].filter((e) => visible(e) && !window.__before.has(e) && !e.matches("[class*=backdrop i]"));
          if (!open.length) return null;
          const boxes = open.map((e) => e.getBoundingClientRect());
          // Okno přes celou obrazovku nemá žádné „vedle“; zavírá se křížkem.
          if (boxes.some((r) => r.width * r.height >= 0.85 * innerWidth * innerHeight)) return { full: true };
          const inside = (x, y) => boxes.some((r) => x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4);
          const active = "a, button, input, select, textarea, summary, label, [role=button], [role=option], [tabindex]:not([tabindex='-1']), [contenteditable]";
          for (let y = innerHeight - 24; y > 24; y -= 37) for (let x = 24; x < innerWidth - 24; x += 41) {
            if (inside(x, y)) continue;
            const hit = document.elementFromPoint(x, y);
            // Pozadí za oknem (backdrop) je „vedle“, i když je technicky tlačítko.
            if (!hit || (hit.closest(active) && !hit.closest("[class*=backdrop i]"))) continue;
            if (open.some((o) => o !== hit && o.contains(hit))) continue;
            return { x, y };
          }
          return null;
        }, CANDIDATES);
        if (point?.full) line += "  out:fullscreen";
        else if (!point) { line += "  out:NOPOINT"; failures.push(`${s.id} ${width}x${height}: no free spot to click outside`); }
        else {
          await page.mouse.click(point.x, point.y);
          await page.waitForTimeout(250);
          const still = await page.evaluate((sel) => {
            const visible = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden" && getComputedStyle(e).display !== "none" && !e.closest("details:not([open])") && !e.closest("dialog:not([open])");
            return [...document.querySelectorAll(sel)].filter((e) => visible(e) && !window.__before.has(e)).length;
          }, CANDIDATES);
          line += `  out:${still ? "OPEN" : "closed"}`;
          if (still) failures.push(`${s.id} ${width}x${height}: a click outside does not close it`);
        }
      }
    } catch (error) {
      line += `ERROR ${String(error).split("\n")[0].slice(0, 90)}`;
      if (process.env.DEBUG) console.log(String(error).split("\n").slice(0, 14).join("\n"));
      failures.push(`${s.id} ${width}x${height}: ${String(error).split("\n")[0].slice(0, 90)}`);
    }
    console.log(line);
    await context.close();
  }
await harness.server.close();
await browser.close();
console.log(failures.length ? `\n${failures.length} problem(s):\n- ${failures.join("\n- ")}` : "\nOverlays OK");
process.exit(failures.length ? 1 : 0);
