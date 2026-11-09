import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit, firefox } from "@playwright/test";
import { fixtures, NOW } from "./fixtures.mjs";
import { startHarness, installNetwork } from "./harness.mjs";
const touch = process.argv.includes("--touch");
const source = process.argv.includes("--local")
  ? process.cwd()
  : "/tmp/splatno-responsive-production-26defdc";
const label = process.argv.includes("--local") ? "local" : "production-source";
const out = resolve("artifacts/responsive-audit/2026-11-02", label);
await mkdir(out, { recursive: true });
const routes = [
  "/",
  "/en",
  "/mfa",
  "/dashboard",
  "/invoices",
  "/invoices/detail",
  "/invoices/new",
  "/invoices/create",
  "/invoices/import",
  "/invoices/payments",
  "/invoices/archive",
  "/invoices/payments/archive",
  "/customers",
  "/reminders",
  "/reports",
  "/settings",
  "/notifications",
  "/predplatne",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/onboarding",
  "/provoz",
  "/podminky",
  "/ochrana-osobnich-udaju",
];
const widths = [
  320, 360, 390, 479, 480, 639, 640, 641, 767, 768, 900, 1023, 1024, 1180, 1279,
  1280, 1440, 1600, 1920, 2560, 3840,
];
const smoke = process.argv.includes("--smoke"),
  states = process.argv.includes("--states"),
  allWidths = process.argv.includes("--matrix"),
  engineName =
    process.argv.find((a) => a.startsWith("--engine="))?.split("=")[1] ||
    "chromium";
const selected = process.argv.find((a) => a.startsWith("--route="))?.slice(8);
const routesOnly = process.argv
  .find((a) => a.startsWith("--routes="))
  ?.slice(9)
  .split(",");
const browser = await { chromium, webkit, firefox }[engineName].launch();
const harness = await startHarness(source, label, 4374);
const results = [];
let resultFile = resolve(
  out,
  `results-${engineName}${touch ? "-touch" : allWidths ? "-matrix" : states ? "-states" : smoke ? "-smoke" : ""}.json`,
);
if (process.argv.includes("--resume")) {
  try {
    const previous = JSON.parse(await readFile(resultFile, "utf8"));
    results.push(
      ...previous.filter(
        (r) =>
          r.status === "measured" &&
          !r.httpErrors.some((e) => e.status === 404),
      ),
    );
    await writeFile(
      resolve(out, `setup-diagnostics-${engineName}.json`),
      JSON.stringify(
        previous.filter(
          (r) =>
            r.status !== "measured" ||
            r.httpErrors.some((e) => e.status === 404),
        ),
        null,
        2,
      ),
    );
  } catch {}
}
const cases = [];
const selectedRoutes = routesOnly
  ? routes.filter((r) => routesOnly.includes(r))
  : selected
    ? routes.filter((r) => r === selected)
    : label === "local"
      ? [
          "/invoices",
          "/invoices/import",
          "/invoices/payments",
          "/reports",
          "/customers",
          "/login",
        ]
      : routes;
for (const route of selectedRoutes) {
  const ws = touch
    ? [320, 390, 640, 768]
    : allWidths
      ? widths
      : engineName === "firefox"
        ? [1280, 1920]
        : smoke
          ? [390, 768, 1440]
          : [390, 768, 1024, 1440, 2560];
  for (const width of process.argv.includes("--states-only") ? [] : ws)
    cases.push({
      route,
      width,
      height:
        width < 768
          ? 844
          : width < 1024
            ? 1024
            : width <= 1440
              ? 900
              : width === 2560
                ? 1440
                : width === 3840
                  ? 2160
                  : 1080,
      scenario: "normal",
    });
  if (
    states &&
    [
      "/dashboard",
      "/invoices",
      "/invoices/detail",
      "/customers",
      "/reminders",
      "/reports",
      "/settings",
      "/predplatne",
      "/notifications",
    ].includes(route)
  )
    for (const scenario of ["empty", "stress", "viewer", "error"])
      for (const width of [390, 1024])
        cases.push({ route, width, height: 900, scenario });
}
try {
  for (const c of cases) {
    if (
      results.some(
        (r) =>
          r.route === c.route &&
          r.width === c.width &&
          r.height === c.height &&
          r.scenario === c.scenario,
      )
    )
      continue;
    const data = await fixtures(source, c.scenario),
      context = await browser.newContext({
        viewport: { width: c.width, height: c.height },
        ...(touch ? { hasTouch: true, isMobile: true } : {}),
        locale: "cs-CZ",
        timezoneId: "Europe/Prague",
        reducedMotion: "reduce",
        deviceScaleFactor: 1,
      });
    const page = await context.newPage();
    const errors = [],
      requests = [],
      httpErrors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.url().includes("/api/") && r.status() >= 400)
        httpErrors.push({
          path: new URL(r.url()).pathname,
          status: r.status(),
        });
    });
    await page.clock.setFixedTime(new Date(NOW));
    await page.addInitScript((d) => {
      window.__AUDIT_DATA__ = d;
    }, data);
    await installNetwork(page, data, c.scenario, requests);
    const row = {
      ...c,
      touchMode: touch,
      source: label,
      engine: engineName,
      errors,
      requests,
      httpErrors,
    };
    try {
      await page.goto(harness.url + c.route + "?audit=" + c.scenario, {
        waitUntil: "load",
        timeout: 30000,
      });
      await page
        .locator("main h1, h1, [data-audit-error]")
        .first()
        .waitFor({ timeout: 20000 });
      await page.evaluate(() => document.fonts.ready);
      // Readiness is tied to actual rendered components and fetch completion, not artificial sleep.
      await page
        .locator("[data-audit-loading]")
        .waitFor({ state: "detached", timeout: 10000 });
      row.metrics = await page.evaluate(() => {
        const main = document.querySelector("main"),
          h = document.querySelector("h1"),
          sidebar = document.querySelector(".sidebar"),
          form = document.querySelector("input:not([type=hidden])"),
          button = document.querySelector(
            "main button:not([aria-hidden=true])",
          );
        const rect = (n) =>
          n
            ? {
                x: n.getBoundingClientRect().x,
                y: n.getBoundingClientRect().y,
                width: n.getBoundingClientRect().width,
                height: n.getBoundingClientRect().height,
              }
            : null;
        const describe = (n) =>
          n.tagName.toLowerCase() +
          (n.className && typeof n.className === "string"
            ? "." + n.className.split(" ").slice(0, 2).join(".")
            : "");
        const visible = (n) => {
          const s = getComputedStyle(n),
            r = n.getBoundingClientRect();
          return (
            s.visibility !== "hidden" &&
            s.display !== "none" &&
            r.width > 0 &&
            r.height > 0 &&
            !n.closest("[aria-hidden=true]")
          );
        };
        const clipped = [...document.querySelectorAll("main *")]
          .filter(
            (n) =>
              n instanceof HTMLElement &&
              visible(n) &&
              n.clientWidth > 0 &&
              n.scrollWidth > n.clientWidth + 2 &&
              ["hidden", "clip"].includes(getComputedStyle(n).overflowX),
          )
          .map((n) => ({
            element: describe(n),
            width: n.clientWidth,
            scrollWidth: n.scrollWidth,
            text: n.innerText?.slice(0, 50),
          }))
          .slice(0, 20);
        const scrollers = [...document.querySelectorAll("main *")]
          .filter(
            (n) =>
              n instanceof HTMLElement &&
              visible(n) &&
              n.clientWidth > 0 &&
              n.scrollWidth > n.clientWidth + 2 &&
              ["auto", "scroll"].includes(getComputedStyle(n).overflowX),
          )
          .map((n) => ({
            element: describe(n),
            width: n.clientWidth,
            scrollWidth: n.scrollWidth,
          }))
          .slice(0, 20);
        const scale = main ? Number(getComputedStyle(main).zoom) || 1 : 1;
        return {
          documentOverflow:
            document.documentElement.scrollWidth > innerWidth + 1,
          documentWidth: document.documentElement.scrollWidth,
          documentHeight: document.documentElement.scrollHeight,
          main: rect(main),
          heading: rect(h),
          headingFont: h ? parseFloat(getComputedStyle(h).fontSize) : null,
          renderedHeadingFont: h
            ? parseFloat(getComputedStyle(h).fontSize) * scale
            : null,
          mainZoom: scale,
          sidebar: rect(sidebar),
          input: rect(form),
          button: rect(button),
          clippedCandidates: clipped,
          horizontalScrollers: scrollers,
          alerts: [...document.querySelectorAll("[role=alert],.form-error")]
            .filter(visible)
            .map((n) => n.textContent.slice(0, 200)),
          errorBoundary:
            document.querySelector("[data-audit-error]")?.textContent || null,
        };
      });
      if (
        [390, 768, 1440, 2560, 3840].includes(c.width) ||
        c.scenario !== "normal"
      ) {
        row.screenshot = `${engineName}${touch ? "-touch" : ""}-${c.route.slice(1).replaceAll("/", "-")}-${c.scenario}-${c.width}x${c.height}.png`;
        await page.screenshot({
          path: resolve(out, row.screenshot),
          fullPage: true,
          animations: "disabled",
        });
      }
      row.status =
        row.metrics.errorBoundary || errors.length
          ? "render-error"
          : "measured";
    } catch (e) {
      row.status = "unverified";
      row.failure = String(e).slice(0, 400);
    }
    results.push(row);
    await writeFile(resultFile, JSON.stringify(results, null, 2));
    await context.close();
    console.log(
      `${engineName} ${label} ${c.route} ${c.scenario} ${c.width}: ${row.status}${row.metrics?.documentOverflow ? " OVERFLOW" : ""}`,
    );
    if (row.status !== "measured")
      throw new Error(
        "Stopped at failed render boundary: " +
          c.route +
          "; fix harness or document limitation before continuing",
      );
  }
} finally {
  await browser.close();
  await harness.server.close();
}
