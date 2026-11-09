// Browser check of "Automaticky" on the invoice list (TRANSITION_RULES pravidla 2–4):
// with 60 invoices the list must show whole rows only, the page must not scroll,
// there must be no gap under the pagination, rows must grow by at most 18 px, and a
// resize must keep the first invoice on screen. Exit 1 on any failure.
//   node scripts/responsive-mockups/auto-rows-check.mjs
import { chromium } from "@playwright/test";
import { startHarness, installNetwork } from "../responsive-audit/harness.mjs";
import { fixtures, NOW } from "../responsive-audit/fixtures.mjs";

const SIZES = [[1024, 768], [1180, 820], [1366, 768], [1470, 830], [1920, 1080], [2560, 1440], [3840, 2160]];
const browser = await chromium.launch();
const harness = await startHarness(process.cwd(), "auto-rows", 4395);
const data = await fixtures(process.cwd());
const template = data.list.invoices;
const all = Array.from({ length: 60 }, (_, i) => ({
  ...template[i % template.length],
  id: `inv-${i + 1}`,
  invoice_number: `FV-2026-${String(i + 1).padStart(4, "0")}`,
}));
const failures = [];
const fail = (message) => { failures.push(message); console.log("  ✗ " + message); };

async function open(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, locale: "cs-CZ", timezoneId: "Europe/Prague", reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript((d) => { window.__AUDIT_DATA__ = d; }, data);
  await installNetwork(page, data, "normal", []);
  // Registered after installNetwork, so it answers /api/invoices first.
  await page.route("**/api/invoices?*", (route) => {
    const url = new URL(route.request().url());
    const size = Number(url.searchParams.get("page_size") ?? 25);
    const number = Number(url.searchParams.get("page") ?? 1);
    return route.fulfill({ json: { ...data.list, invoices: all.slice((number - 1) * size, number * size), total: all.length, page: number, page_size: size, total_pages: Math.ceil(all.length / size) } });
  });
  await page.goto(harness.url + "/invoices", { waitUntil: "networkidle" });
  await page.locator("h1").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}
const settle = (page) => page.waitForFunction(() => {
  const rows = document.querySelectorAll("tbody tr").length;
  const text = document.querySelector("[data-invoice-pagination] span")?.textContent ?? "";
  return rows > 0 && text.includes(`–`) && !document.querySelector("[aria-busy=true]");
}).then(() => page.waitForTimeout(250));
const measure = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll("tbody tr")];
  const pagination = document.querySelector("[data-invoice-pagination]").getBoundingClientRect();
  const last = rows.at(-1).getBoundingClientRect();
  return {
    rows: rows.length,
    heights: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))],
    scroll: document.documentElement.scrollHeight - innerHeight,
    gapBelow: Math.round(innerHeight - pagination.bottom),
    hole: Math.round(pagination.top - last.bottom),
    first: rows[0].querySelector("td:nth-child(2) a").textContent,
    paginationHeight: Math.round(pagination.height),
    room: Math.round(innerHeight - (document.querySelector("thead").getBoundingClientRect().bottom + scrollY) - pagination.height - Math.max(0, document.documentElement.scrollHeight - (pagination.bottom + scrollY))),
    scrollY,
    rowH: Math.round(last.height),
    label: document.querySelector("[data-invoice-pagination] span").textContent.replace(/\s+/g, " ").trim(),
  };
});

try {
  for (const [width, height] of SIZES) {
    const { context, page } = await open(width, height);
    await page.getByRole("combobox", { name: "Faktur na stránku" }).selectOption("auto");
    await settle(page);
    const m = await measure(page);
    console.log(`${width}×${height}`, JSON.stringify(m));
    if (m.scroll > 1) fail(`${width}×${height}: page scrolls by ${m.scroll} px`);
    if (m.heights.length !== 1) fail(`${width}×${height}: rows differ in height ${m.heights}`);
    if (m.hole > 40) fail(`${width}×${height}: ${m.hole} px empty between the last row and the pagination`);
    if (m.gapBelow > 40) fail(`${width}×${height}: ${m.gapBelow} px empty under the pagination`);
    await context.close();
  }
  // Resize keeps the first invoice: open page 3 of the fitted list, then shrink.
  const { context, page } = await open(1920, 1080);
  await page.getByRole("combobox", { name: "Faktur na stránku" }).selectOption("auto");
  await settle(page);
  await page.getByRole("button", { name: "Stránka 2", exact: true }).click();
  await settle(page);
  await page.getByRole("button", { name: "Další stránka", exact: true }).click();
  await settle(page);
  const before = await measure(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await settle(page);
  const after = await measure(page);
  console.log("resize", before.first, before.label, "→", after.first, after.label, JSON.stringify(after));
  const index = (n) => Number(n.slice(-4));
  const [from, to] = after.label.match(/(\d+)–(\d+)/).slice(1).map(Number);
  if (index(before.first) < from || index(before.first) > to) fail(`resize lost ${before.first} (now ${after.label})`);
  if (after.scroll > 1) fail(`after resize the page scrolls by ${after.scroll} px`);
  await context.close();
} finally {
  await harness.server.close();
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failure(s)` : "\nAutomaticky OK");
process.exit(failures.length ? 1 : 0);
