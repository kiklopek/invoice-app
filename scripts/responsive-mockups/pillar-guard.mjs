// Safety net for the extended responsive work: the two pillars (mobile, MacBook Air 13")
// must stay pixel-identical unless a change is an intended fix.
//
//   node scripts/responsive-mockups/pillar-guard.mjs baseline   # before a change
//   node scripts/responsive-mockups/pillar-guard.mjs check      # after it; exit 1 on a diff
//   ... [--only=/invoices,/customers] [--sizes=390x844,1470x830]
//
// Real components, synthetic data (isolated Vite harness). Screenshots go to
// artifacts/responsive-guard/{baseline,current}/, diffs as *-diff.png next to them.
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { startHarness, installNetwork } from "../responsive-audit/harness.mjs";
import { fixtures, NOW } from "../responsive-audit/fixtures.mjs";

const mode = process.argv[2];
if (!["baseline", "check"].includes(mode)) {
  console.error("usage: pillar-guard.mjs baseline|check [--only=/a,/b] [--sizes=WxH,...]");
  process.exit(2);
}
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ROUTES = (arg("only")?.split(",") ?? [
  "/dashboard", "/invoices", "/invoices/detail", "/invoices/new", "/invoices/create",
  "/invoices/import", "/invoices/payments", "/invoices/archive", "/invoices/payments/archive",
  "/customers", "/reminders", "/reports", "/settings", "/notifications", "/predplatne",
  "/settings/email-template", "/onboarding",
  // Public pages (no workspace shell).
  "/login", "/register", "/forgot-password", "/reset-password", "/mfa",
  "/pozvanka/audit", "/podminky", "/ochrana-osobnich-udaju",
]);
const SIZES = (arg("sizes")?.split(",") ?? ["342x740", "390x844", "1470x830"]).map((s) => {
  const [width, height] = s.split("x").map(Number);
  return { width, height, mobile: width < 1000 };
});

const root = resolve("artifacts/responsive-guard");
const dir = resolve(root, mode === "baseline" ? "baseline" : "current");
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const harness = await startHarness(process.cwd(), "responsive-guard", 4392);
const data = await fixtures(process.cwd());
const results = [];
try {
  for (const route of ROUTES)
    for (const size of SIZES) {
      const name = `${route.slice(1).replaceAll("/", "_")}--${size.width}x${size.height}`;
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        locale: "cs-CZ", timezoneId: "Europe/Prague", reducedMotion: "reduce",
        hasTouch: size.mobile, isMobile: size.mobile,
      });
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date(NOW));
      await page.addInitScript((d) => { window.__AUDIT_DATA__ = d; }, data);
      await installNetwork(page, data, "normal", []);
      await page.goto(harness.url + route, { waitUntil: "networkidle" });
      await page.locator("h1").first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      const file = resolve(dir, `${name}.png`);
      await page.screenshot({ path: file, fullPage: true, animations: "disabled", caret: "hide" });
      await context.close();
      if (mode === "check") results.push({ name, ...(await compare(name)) });
      process.stdout.write(mode === "check" ? `${results.at(-1).status.padEnd(5)} ${name}${results.at(-1).note ?? ""}\n` : `saved ${name}\n`);
    }
} finally {
  await browser.close();
  await harness.server.close();
}
if (mode === "check") {
  await writeFile(resolve(root, "check.json"), JSON.stringify(results, null, 2));
  const bad = results.filter((r) => r.status !== "same");
  console.log(`\n${results.length - bad.length}/${results.length} identical`);
  process.exit(bad.length ? 1 : 0);
}

async function compare(name) {
  const base = resolve(root, "baseline", `${name}.png`);
  if (!(await access(base).then(() => true, () => false))) return { status: "new", note: " (no baseline)" };
  const [a, b] = await Promise.all([base, resolve(dir, `${name}.png`)].map((p) =>
    readFile(p).then((buf) => sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }))));
  if (a.info.width !== b.info.width || a.info.height !== b.info.height)
    return { status: "size", note: ` ${a.info.width}×${a.info.height} → ${b.info.width}×${b.info.height}` };
  const { width, height } = a.info;
  const diff = Buffer.alloc(width * height * 4);
  let count = 0, minY = height, maxY = -1;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (d > 24) {
      count++; const y = Math.floor(i / 4 / width); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      diff[i] = 230; diff[i + 1] = 20; diff[i + 2] = 60; diff[i + 3] = 255;
    } else { diff[i] = b.data[i]; diff[i + 1] = b.data[i + 1]; diff[i + 2] = b.data[i + 2]; diff[i + 3] = 70; }
  }
  if (!count) return { status: "same" };
  await sharp(diff, { raw: { width, height, channels: 4 } }).png().toFile(resolve(dir, `${name}-diff.png`));
  return { status: "diff", pixels: count, rows: [minY, maxY], note: ` ${count} px in y ${minY}–${maxY}` };
}
