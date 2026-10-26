import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(vitestRequire.resolve("vite")).href);
const project = process.cwd();
const fixture = resolve(".cache/gpc-loading");
const output = resolve("artifacts/gpc-loading");
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });
await writeFile(resolve(fixture, "index.html"), '<html lang="cs"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>');
await writeFile(resolve(fixture, "link.tsx"), "import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}");
await writeFile(resolve(fixture, "shell.tsx"), "import React from 'react';export function AppFrame({children,...props}){return <main {...props}>{children}</main>}");
await writeFile(resolve(fixture, "entry.tsx"), `import React from 'react';import {createRoot} from 'react-dom/client';import '${project}/src/app/globals.css';import '${project}/src/app/minimal.css';import '${project}/src/app/styles/responsive.css';import {PaymentsClient} from '${project}/src/app/(workspace)/invoices/payments/payments-client';createRoot(document.getElementById('root')).render(<PaymentsClient initialData={{payments:[],open_invoices:[],can_manage:true,gpc_enabled:true,runtime_mode:'production-database'}}/>);`);
const server = await createServer({
  configFile: false, root: fixture, publicDir: resolve("public"), logLevel: "error",
  server: { host: "127.0.0.1", port: 4346, strictPort: true, fs: { allow: [project] } },
  esbuild: { jsx: "automatic" }, css: { postcss: { plugins: [] } },
  resolve: { alias: [
    { find: "@/components/layout/app-shell", replacement: resolve(fixture, "shell.tsx") },
    { find: "next/link", replacement: resolve(fixture, "link.tsx") },
    { find: "@", replacement: resolve("src") },
  ], dedupe: ["react", "react-dom"] },
});
const preview = { import: { id: "fixture-statement", revision: 1, duplicate: false, status: "review" }, account_mismatch: false, statement_account: null, expected_account: null, totals: { accepted: 0, ignored: 0, errors: 0 }, entries: [], proposal_invoices: [], total_entries: 0, request_id: "fixture" };
await server.listen();
const browser = await chromium.launch();
const results = [];
try {
  for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1440, 900]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    let releaseSave, releaseBooking;
    const saving = new Promise(resolve => { releaseSave = resolve; });
    const booking = new Promise(resolve => { releaseBooking = resolve; });
    await page.route("**/api/payments/**", async route => {
      const request = route.request();
      if (request.url().endsWith("/commit")) {
        await booking;
        return route.fulfill({ json: { status: "committed", remaining: 0, errors: [], imported: 0, matched: 0, revision: 3 } });
      }
      if (request.method() === "PATCH") {
        await saving;
        return route.fulfill({ json: { revision: 2 } });
      }
      if (request.method() === "POST") {
        await pending;
        return route.fulfill({ json: preview });
      }
      if (request.url().includes("invoice-candidates")) return route.fulfill({ json: { invoices: [], total: 0 } });
      return route.fulfill({ json: request.url().includes("fixture-statement") ? { ...preview, total: 0, allocations: [], progress: { booked: 0, errors: 0, remaining: 0 }, match_reasons: {} } : { imports: [] } });
    });
    try {
      await page.goto("http://127.0.0.1:4346");
      await page.locator('input[type="file"]').setInputFiles([
        { name: "first.gpc", mimeType: "text/plain", buffer: Buffer.from("fixture") },
        { name: "second.gpc", mimeType: "text/plain", buffer: Buffer.from("fixture") },
      ]);
      const loader = page.locator("[data-statement-processing]");
      await expect(loader).toBeVisible();
      await expect(loader).toContainText("Výpis 1 z 2");
      await expect(loader.locator('[aria-current="step"]')).toContainText("Načítání a párování plateb");
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
      expect(await loader.getByRole("progressbar").getAttribute("aria-valuenow")).toBeNull();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: resolve(output, `loading-${width}.png`), fullPage: true });
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await loader.getByRole("progressbar").locator("span").evaluate(el => getComputedStyle(el).animationName)).toBe("none");
      release();
      await expect(page.locator(".gpc-preview")).toBeVisible();
      await expect(loader).toHaveCount(0);
      await page.getByRole("button", { name: "Zaúčtovat výpis", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(loader).toHaveCount(0);
      await page.getByRole("dialog").getByRole("button", { name: "Zaúčtovat", exact: true }).click();
      await expect(loader.locator('[aria-current="step"]')).toContainText("Uložení přiřazení");
      releaseSave();
      await expect(loader.locator('[aria-current="step"]')).toContainText("Zaúčtování plateb");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: resolve(output, `booking-${width}.png`), fullPage: true });
      releaseBooking();
      await expect(loader).toHaveCount(0);
      await expect(page.getByText("Import proběhl úspěšně.", { exact: true })).toBeVisible();
      expect(errors).toEqual([]);
      results.push({ width, height, passed: true });
    } catch (error) {
      release();
      releaseSave(); releaseBooking();
      results.push({ width, height, passed: false, error: String(error) });
    } finally { await page.close(); }
  }
} finally { await browser.close(); await server.close(); }
await writeFile(resolve(output, "results.json"), JSON.stringify({ scope: "Real payments UI and shared OCR/statement loading styles; API fixtures only, no live statement imports.", results }, null, 2));
console.log(JSON.stringify(results, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
