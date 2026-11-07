// Read-only production measurement. Session reuse requires the explicit CLI flag
// and the user's recorded authorization; cookies never enter logs or artifacts.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
const out = resolve("artifacts/responsive-audit/2026-11-02/production-live");
await mkdir(out, { recursive: true });
const ref = JSON.parse(
  await readFile(
    resolve("artifacts/responsive-audit/2026-11-02/macbook-reference.json"),
    "utf8",
  ),
);
const width = ref.width || 1440,
  height = ref.height || 900;
const browser = await chromium.launch(),
  results = [];
try {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    reducedMotion: "reduce",
  });
  const authorized = process.argv.includes("--authorized-test-session");
  if (authorized) {
    const state = JSON.parse(
      await readFile(resolve("e2e/.auth/state.json"), "utf8"),
    );
    await context.addCookies(
      state.cookies
        .filter((c) => c.domain === "127.0.0.1")
        .map((c) => ({ ...c, domain: "www.splatno.com", secure: true })),
    );
  }
  const page = await context.newPage();
  const blocked = [];
  await page.route("**/*", (route) => {
    const request = route.request();
    if (!["GET", "HEAD"].includes(request.method())) {
      blocked.push({
        method: request.method(),
        path: new URL(request.url()).pathname,
      });
      return route.abort();
    }
    return route.continue();
  });
  for (const route of [
    "/dashboard",
    "/invoices",
    "/invoices/import",
    "/login",
    "/",
    "/register",
    "/podminky",
    "/ochrana-osobnich-udaju",
  ]) {
    const row = {
      route,
      width,
      height,
      authorizedSessionReuse: authorized,
      referenceStatus:
        ref.status === "reported"
          ? "production at user-reported viewport"
          : "diagnostic only; not actual MacBook viewport",
      blockedWrites: blocked,
    };
    try {
      const response = await page.goto("https://www.splatno.com" + route, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      await page.locator("h1").first().waitFor({ timeout: 15000 });
      await page.evaluate(() => document.fonts.ready);
      row.httpStatus = response?.status();
      row.finalPath = new URL(page.url()).pathname;
      row.authenticatedRouteCaptured =
        row.finalPath === route &&
        ["/dashboard", "/invoices", "/invoices/import"].includes(route);
      row.metrics = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
        heading: document.querySelector("h1")?.textContent,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        userAgent: navigator.userAgent,
        headingFont: getComputedStyle(document.querySelector("h1")).fontSize,
        sidebarWidth: document
          .querySelector(".sidebar")
          ?.getBoundingClientRect().width,
      }));
      if (row.authenticatedRouteCaptured) {
        const dir = resolve(".cache/responsive-audit/private-production");
        await mkdir(dir, { recursive: true });
        row.privateScreenshot = resolve(
          dir,
          route.slice(1).replaceAll("/", "-") + `-${width}x${height}.png`,
        );
        await page.screenshot({ path: row.privateScreenshot, fullPage: true });
      } else if (row.finalPath === route) {
        row.screenshot =
          route === "/" ? "public-landing.png" : `public-${route.slice(1)}.png`;
        await page.screenshot({
          path: resolve(out, row.screenshot),
          fullPage: true,
        });
      }
    } catch (error) {
      row.failure = String(error).slice(0, 400);
    }
    results.push(row);
    await writeFile(
      resolve(out, "observations.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(
      JSON.stringify({
        route,
        finalPath: row.finalPath,
        status: row.httpStatus,
        authenticated: row.authenticatedRouteCaptured,
        failure: row.failure,
      }),
    );
  }
  await context.close();
} finally {
  await browser.close();
}
