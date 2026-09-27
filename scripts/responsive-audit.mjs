import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

const baseURL = process.env.RESPONSIVE_AUDIT_BASE_URL ?? "http://localhost:3000";
const storageStatePath = "e2e/.auth/state.json";
const routes = (process.env.RESPONSIVE_AUDIT_ROUTES ?? [
  "/dashboard",
  "/invoices",
  "/invoices/new",
  "/invoices/import",
  "/invoices/archive",
  "/invoices/payments",
  "/invoices/payments/archive",
  "/customers",
  "/reminders",
  "/reports",
  "/settings",
].join(",")).split(",").filter(Boolean);
const viewports = [
  { name: "phone-small", width: 320, height: 740 },
  { name: "phone", width: 390, height: 844 },
  { name: "landscape", width: 844, height: 390 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop-edge", width: 1024, height: 900 },
];

const browser = await chromium.launch({ headless: true });
const problems = [];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport,
      storageState: existsSync(storageStatePath) ? storageStatePath : undefined,
    });
    const page = await context.newPage();
    for (const route of routes) {
      await page.goto(new URL(route, baseURL).href, { waitUntil: "networkidle" });
      const state = await page.evaluate(() => {
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };
        const width = document.documentElement.clientWidth;
        const overflow = [...document.querySelectorAll("body *")]
          .filter(visible)
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .filter(({ element, rect }) => {
            if (element.closest(".period-presets, .report-tabs, .friendly-tabs, .gpc-filter-chips")) return false;
            return rect.left < -1 || rect.right > width + 1;
          })
          .slice(0, 8)
          .map(({ element, rect }) => `${element.tagName.toLowerCase()}.${String(element.className).split(" ").slice(0, 2).join(".")} (${Math.round(rect.left)}..${Math.round(rect.right)})`);
        return {
          path: location.pathname,
          documentOverflow: document.documentElement.scrollWidth > width + 1,
          overflow,
          hamburger: [...document.querySelectorAll(".mobile-navigation-shell")].some(visible),
          desktopNavigation: [...document.querySelectorAll(".desktop-navigation")].some(visible),
        };
      });
      if (state.path.startsWith("/login")) problems.push(`${viewport.name} ${route}: chybí přihlášená session`);
      if (state.documentOverflow || state.overflow.length) problems.push(`${viewport.name} ${route}: ${state.overflow.join(", ") || "document overflow"}`);
      if (viewport.width < 1024 && (!state.hamburger || state.desktopNavigation)) problems.push(`${viewport.name} ${route}: chybná mobilní navigace`);
      if (viewport.width >= 1024 && (state.hamburger || !state.desktopNavigation)) problems.push(`${viewport.name} ${route}: chybná desktopová navigace`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Responzivní audit prošel: ${routes.length} rout × ${viewports.length} viewportů.`);
}
