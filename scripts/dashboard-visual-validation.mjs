// Isolated Next.js presentation fixture. Original auth/API/backend files in the
// working tree are never changed; no production service or user account is used.
import { cp, copyFile, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import {
  invoices,
  scenarioSummary,
  scenarioReport,
  scenarioInvoiceDetail,
  scenarioInvoiceCount,
} from "./dashboard-design-fixtures.mjs";

const root = process.cwd();
const revision = process.argv
  .find((arg) => arg.startsWith("--revision="))
  ?.slice(11);
if (revision && !/^[a-z0-9-]+$/.test(revision))
  throw new Error("Invalid revision name");
const out = resolve(
  root,
  "docs/redesign/visual-validation/dashboard",
  revision || "",
);
const snapshot = "/private/tmp/splatno-dashboard-visual-next";
const stage = process.argv.includes("--before")
  ? "before"
  : process.argv.includes("--layout")
    ? "layout"
    : "after";
await mkdir(out, { recursive: true });
if (stage === "before" && existsSync(join(out, "current-before.png")))
  throw new Error("Before baseline already exists; refusing to overwrite.");
await mkdir(snapshot, { recursive: true });
await cp(join(root, "src"), join(snapshot, "src"), {
  recursive: true,
  force: true,
});
for (const name of [
  "package.json",
  "tsconfig.json",
  "next.config.js",
  "postcss.config.mjs",
  "postcss.config.js",
])
  if (existsSync(join(root, name)))
    await copyFile(join(root, name), join(snapshot, name));
for (const name of ["node_modules", "public", "assets"])
  if (existsSync(join(root, name)) && !existsSync(join(snapshot, name)))
    await symlink(join(root, name), join(snapshot, name));
// Test-only bootstrap substitutions confined to /private/tmp; actual Next Link,
// router, Image, CSS extraction, AppShell, DashboardClient and SWR are exercised.
await rm(join(snapshot, "src/proxy.ts"), { force: true });
await writeFile(
  join(snapshot, "src/app/(workspace)/layout.tsx"),
  `import {AppShell} from '@/components/layout/app-shell';import {WorkspaceDataProvider} from '@/components/workspace-data-provider';import {ToastProvider} from '@/components/toast';export default function Layout({children}:{children:React.ReactNode}){return <WorkspaceDataProvider><ToastProvider><AppShell initialProfile={{role:'admin',name:'Anna Nováková',email:'anna@example.invalid',companyName:'Ukázková společnost s.r.o.'}}>{children}</AppShell></ToastProvider></WorkspaceDataProvider>}`,
);
await writeFile(
  join(snapshot, "src/app/(workspace)/dashboard/page.tsx"),
  `import {DashboardClient} from './dashboard-client';export default function Page(){return <DashboardClient initialData={${JSON.stringify(scenarioSummary("normal"))}} initialNow="2026-10-17T08:00:00.000Z"/>}`,
);
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  NODE_ENV: "development",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: "https://visual-fixture.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "visual-fixture",
  SUPABASE_SERVICE_ROLE_KEY: "visual-fixture",
  APP_BASE_URL: "http://127.0.0.1:4330",
  EMAIL_MFA_SECRET: "visual-fixture-secret-with-at-least-32-characters",
  OCR_PROVIDER: "local",
  NEXT_PUBLIC_OCR_PROVIDER: "local",
};
const log = createWriteStream(join(out, `next-${stage}.log`));
const server = spawn(
  process.execPath,
  [
    join(root, "node_modules/next/dist/bin/next"),
    "dev",
    "--webpack",
    "--hostname",
    "127.0.0.1",
    "--port",
    "4330",
  ],
  { cwd: snapshot, env, stdio: ["ignore", "pipe", "pipe"] },
);
server.stdout.pipe(log);
server.stderr.pipe(log);
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch("http://127.0.0.1:4330/dashboard");
      if (r.ok) break;
    } catch {}
    if (i === 119) throw new Error("Next fixture failed to start");
    await new Promise((r) => setTimeout(r, 500));
  }
  await copyFile(
    join(
      root,
      "docs/redesign/screens/dashboard/reference/assets/00-full-dashboard.png",
    ),
    join(out, "reference.png"),
  );
  for (const [width, height] of stage === "layout"
    ? [[1536, 1024]]
    : [
        [1536, 1024],
        [1920, 1080],
        [1920, 1200],
        [1440, 900],
        [1280, 800],
        [1366, 768],
        [1440, 820],
        [1280, 740],
        [1280, 700],
        [1280, 660],
        [1280, 900],
        [1180, 820],
        [1180, 660],
        [1180, 740],
        [1194, 768],
        [1440, 760],
        [820, 1180],
        [390, 844],
      ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.hostname !== "127.0.0.1") {
        errors.push(`Blocked external browser request: ${url.hostname}`);
        return route.abort();
      }
      if (url.pathname.startsWith("/api/")) {
        if (req.method() !== "GET") {
          errors.push(`Blocked mutation: ${req.method()} ${url.pathname}`);
          return route.fulfill({ status: 405, json: {} });
        }
        if (url.pathname === "/api/settings/reminders")
          return route.fulfill({ json: { active: true } });
        if (url.pathname === "/api/dashboard")
          return route.fulfill({ json: scenarioSummary("normal") });
        if (url.pathname === "/api/invoices")
          return route.fulfill({
            json: {
              invoices,
              total: scenarioInvoiceCount(url),
              currencies: ["CZK", "EUR"],
              active_count: 25,
            },
          });
        const detailMatch = url.pathname.match(
          /^\/api\/invoices\/([^/]+)\/page-data$/,
        );
        if (detailMatch)
          return route.fulfill({
            json: scenarioInvoiceDetail(detailMatch[1], "normal"),
          });
        if (url.pathname === "/api/reports")
          return route.fulfill({
            json: scenarioReport(url),
          });
        errors.push(`Unexpected API request: ${url.pathname}`);
        return route.fulfill({ status: 404, json: {} });
      }
      // Avoid prefetching unrelated authenticated server pages in this fixture.
      if (req.headers()["next-router-prefetch"])
        return route.fulfill({ status: 204, body: "" });
      return route.continue();
    });
    await page.goto("http://127.0.0.1:4330/dashboard");
    await page.locator("main").waitFor();
    await page.waitForFunction(() =>
      document.querySelector("main")?.textContent?.includes("124"),
    );
    await page.evaluate(() => document.fonts.ready);
    await page
      .locator(
        'section[aria-labelledby="dashboard-trend-heading"][aria-busy="false"]',
      )
      .waitFor();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    const measurement = await page.evaluate(() => {
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return Object.fromEntries(
          ["x", "y", "width", "height", "bottom", "right"].map((k) => [
            k,
            Math.round(r[k] * 100) / 100,
          ]),
        );
      };
      const card = (id) =>
        document.getElementById(id)?.closest("section,aside");
      const main = document.querySelector("main");
      return {
        viewport: {
          width: innerWidth,
          height: innerHeight,
          outerHeight,
          devicePixelRatio,
        },
        document: {
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        },
        rects: {
          sidebar: rect(document.querySelector(".sidebar")),
          brand: rect(document.querySelector(".sidebar>.brand")),
          topbar: rect(main.children[0]),
          search: rect(document.querySelector('form[role="search"]')),
          heading: rect(main.querySelector("header")),
          title: rect(main.querySelector("h1")),
          kpi: [
            ...main.querySelectorAll(
              'section[aria-label="Souhrn pohledávek"]>article',
            ),
          ].map(rect),
          trend: rect(card("dashboard-trend-heading")),
          donut: rect(card("dashboard-status-heading")),
          invoices: rect(card("dashboard-invoices-heading")),
          reminders: rect(card("dashboard-reminders-heading")),
          esko: rect(
            document.querySelector('button[aria-controls="esko-panel"]'),
          ),
        },
        reminderChildren: [
          ...card("dashboard-reminders-heading").querySelectorAll(
            ":scope>* , ol>li",
          ),
        ].map((el) => ({
          tag: el.tagName,
          class: el.className,
          rect: rect(el),
          minHeight: getComputedStyle(el).minHeight,
          padding: getComputedStyle(el).padding,
          margin: getComputedStyle(el).margin,
          gap: getComputedStyle(el).gap,
        })),
        invoiceRows: card("dashboard-invoices-heading").querySelectorAll(
          "tbody tr",
        ).length,
        nestedScroll: [...main.querySelectorAll("*")].filter(
          (el) =>
            /auto|scroll/.test(getComputedStyle(el).overflowY) &&
            el.scrollHeight > el.clientHeight + 1,
        ).length,
      };
    });
    if (measurement.document.width > width + 1)
      errors.push("Horizontal overflow");
    if (stage === "after" && width >= 1180 && height >= 660) {
      if (measurement.document.height > height + 1)
        errors.push("Desktop whole-page scroll");
      for (const key of ["invoices", "reminders"])
        if (measurement.rects[key].bottom > height + 1)
          errors.push(`Hidden ${key}`);
      if (measurement.invoiceRows !== 5) errors.push("Expected five invoices");
    }
    await page.screenshot({
      path: join(out, `${stage}-${width}x${height}.png`),
      fullPage: true,
    });
    if (width === 1536)
      await page.screenshot({
        path: join(out, `current-${stage}.png`),
        fullPage: true,
      });
    results.push({ ...measurement, errors });
    await page.close();
  }
} finally {
  await browser.close();
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  log.end();
  await writeFile(
    join(out, `measurements-${stage}.json`),
    JSON.stringify(
      {
        type: "isolated real Next dev app; synthetic read-only bootstrap/API fixtures; no production auth or database E2E",
        results,
      },
      null,
      2,
    ) + "\n",
  );
}
if (stage === "after") {
  const ref = await sharp(join(out, "reference.png")).metadata(),
    cur = await sharp(join(out, "current-after.png")).metadata();
  if (ref.width !== cur.width || ref.height !== cur.height)
    throw new Error(
      "Reference/current dimensions differ; pixel comparison refused.",
    );
  const raw = await sharp(join(out, "current-after.png"))
    .ensureAlpha()
    .raw()
    .toBuffer();
  for (let i = 3; i < raw.length; i += 4) raw[i] = 128;
  await sharp(join(out, "reference.png"))
    .composite([
      {
        input: raw,
        raw: { width: ref.width, height: ref.height, channels: 4 },
      },
    ])
    .png()
    .toFile(join(out, "overlay.png"));
  const a = await sharp(join(out, "reference.png"))
      .removeAlpha()
      .raw()
      .toBuffer(),
    b = await sharp(join(out, "current-after.png"))
      .removeAlpha()
      .raw()
      .toBuffer();
  const diff = Buffer.alloc(a.length);
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    diff[i] = Math.abs(a[i] - b[i]);
    sum += diff[i];
  }
  await sharp(diff, {
    raw: { width: ref.width, height: ref.height, channels: 3 },
  })
    .png()
    .toFile(join(out, "difference.png"));
  await writeFile(
    join(out, "pixel-comparison.json"),
    JSON.stringify(
      {
        width: ref.width,
        height: ref.height,
        meanAbsoluteChannelDifference: sum / a.length,
        note: "Raw RGB difference includes different real user/data/text. It is not a visual similarity percentage.",
      },
      null,
      2,
    ) + "\n",
  );
}
console.log(JSON.stringify({ stage, results }, null, 2));
if (results.some((x) => x.errors.length)) process.exitCode = 1;
