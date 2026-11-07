import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium, webkit, expect } from "@playwright/test";
import { reportsFixture } from "./reports-design-fixtures.mjs";
const project = process.cwd(),
  fixture = resolve(".cache/workspace-scaling"),
  output = resolve("/tmp/workspace-scaling-check");
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });
await writeFile(
  resolve(fixture, "index.html"),
  '<html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>',
);
await writeFile(
  resolve(fixture, "link.tsx"),
  "import{createElement}from'react';export default function Link({children,prefetch:_p,...props}){return createElement('a',props,children)}",
);
await writeFile(
  resolve(fixture, "image.tsx"),
  "import{createElement}from'react';export default function Image({priority:_p,preload:_pr,fill:_f,unoptimized:_u,...props}){return createElement('img',props)}",
);
await writeFile(
  resolve(fixture, "navigation.tsx"),
  "export function usePathname(){return location.pathname}export function useRouter(){return{push:url=>location.assign(url),replace:url=>location.replace(url),prefetch:()=>{},refresh:()=>{}}}export function useSearchParams(){return new URLSearchParams(location.search)}",
);
await writeFile(
  resolve(fixture, "entry.tsx"),
  `import React from 'react';import{createRoot}from'react-dom/client';import '${project}/src/app/globals.css';import '${project}/src/app/minimal.css';import '${project}/src/app/styles/responsive.css';import{AppShell}from'${project}/src/components/layout/app-shell';import{WorkspaceDataProvider}from'${project}/src/components/workspace-data-provider';import{ToastProvider}from'${project}/src/components/toast';import InvoiceImportPage from'${project}/src/app/(workspace)/invoices/import/page';import{PaymentsClient}from'${project}/src/app/(workspace)/invoices/payments/payments-client';import{ReportsClient}from'${project}/src/app/(workspace)/reports/reports-client';import{reportsFixture}from'${project}/scripts/reports-design-fixtures.mjs';const q=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<WorkspaceDataProvider><ToastProvider><AppShell initialProfile={{role:q.get('role')||'admin',name:'Tomáš R.',email:'fixture@example.invalid',companyName:'Demo firma s.r.o.',vatPayer:q.get('vat')!=='false'}}>{location.pathname==='/invoices/import'?<InvoiceImportPage/>:location.pathname==='/invoices/payments'?<PaymentsClient initialData={{payments:[],open_invoices:[],can_manage:true,gpc_enabled:true,runtime_mode:'production-database'}}/>:<ReportsClient initialData={reportsFixture(q.get('mode')||'populated')} initialFrom="2026-01-01" initialTo="2026-10-23" initialGeneratedAt="2026-10-23T08:00:00Z"/>}</AppShell></ToastProvider></WorkspaceDataProvider>);`,
);
const require = createRequire(import.meta.url),
  vr = createRequire(require.resolve("vitest/config"));
const { createServer } = await import(pathToFileURL(vr.resolve("vite")).href);
const server = await createServer({
  configFile: false,
  define: { "process.env": "{}" },
  root: fixture,
  publicDir: resolve("public"),
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: 4357,
    strictPort: true,
    fs: { allow: [project] },
  },
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: [
      { find: "next/link", replacement: resolve(fixture, "link.tsx") },
      { find: "next/image", replacement: resolve(fixture, "image.tsx") },
      {
        find: "next/navigation",
        replacement: resolve(fixture, "navigation.tsx"),
      },
      { find: "@", replacement: resolve("src") },
    ],
    dedupe: ["react", "react-dom"],
  },
});
await server.listen();

// Exercise the real shell and page components with isolated read-only fixtures.
const deferred = [];
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill({
          json:
            path === "/api/reports"
              ? reportsFixture("populated")
              : path === "/api/notifications"
                ? { items: [], unread_count: 0, total: 0, has_more: false }
                : {
                    count: 35,
                    invoices: [],
                    items: [],
                    imports: [],
                    unread: 0,
                  },
        });
      });
      for (const route of [
        "/invoices/import",
        "/invoices/payments",
        "/reports",
      ]) {
        let reference;
        for (const width of [390, 768, 1280, 1600, 1920, 2560, 3200, 3840]) {
          const height =
            width >= 1280 ? Math.round((width * 900) / 1600) : 1024;
          await page.setViewportSize({ width, height });
          await page.goto(`http://127.0.0.1:4357${route}`);
          await expect(page.locator("main h1")).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          const metrics = await page.evaluate(() => {
            const shell = document.querySelector(".app-shell");
            const heading = document.querySelector("main h1");
            const sidebar = document.querySelector(".sidebar");
            const icon = document.querySelector(
              ".desktop-navigation .nav-symbol svg",
            );
            return {
              overflow: document.documentElement.scrollWidth > innerWidth,
              scale: Number(
                getComputedStyle(document.querySelector("main")).zoom,
              ),
              shellScale: Number(getComputedStyle(shell).zoom),
              mainLeft: document.querySelector("main").getBoundingClientRect()
                .left,
              headingFont: parseFloat(getComputedStyle(heading).fontSize),
              sidebarWidth: sidebar.getBoundingClientRect().width,
              sidebarHeight: sidebar.getBoundingClientRect().height,
              iconWidth: icon?.getBoundingClientRect().width,
              mainRight: document.querySelector("main").getBoundingClientRect()
                .right,
              height: document.documentElement.scrollHeight,
            };
          });
          expect(
            metrics.overflow,
            `${engine.name()} ${route} ${width}: horizontal overflow`,
          ).toBe(false);
          // TRANSITION_RULES pravidla 5 a 6: no zoom anywhere; navigation steps
          // to real sizes (rail 84 / 220 / 244 / 280 / 320 px) and the content
          // starts right after it and fills the rest of the window.
          if (width === 1600) reference = metrics;
          expect(metrics.scale).toBe(1);
          expect(metrics.shellScale).toBe(1);
          if (width >= 1024) {
            const nav = width >= 2200 ? 320 : width >= 1600 ? 280 : width >= 1200 ? 244 : width >= 1100 ? 220 : 84;
            expect(metrics.sidebarWidth).toBeCloseTo(nav, 0);
            expect(metrics.mainLeft).toBeCloseTo(nav, 0);
            expect(metrics.sidebarHeight).toBeCloseTo(height, 0);
            expect(Math.abs(metrics.mainRight - width)).toBeLessThan(2);
          }
          if (width >= 1600) {
            expect(metrics.iconWidth).toBeGreaterThanOrEqual(reference.iconWidth);
            expect(metrics.headingFont).toBeGreaterThanOrEqual(reference.headingFont - 0.5);
            expect(metrics.headingFont).toBeLessThanOrEqual(56);
          }
          if (route === "/invoices/import" && width >= 1600) {
            const gaps = await page
              .locator(".invoice-document-import")
              .evaluate((panel) => {
                const header = document.querySelector(
                  ".invoice-import-tabs",
                ).parentElement;
                return {
                  above:
                    panel.getBoundingClientRect().top -
                    header.getBoundingClientRect().bottom,
                  below: innerHeight - panel.getBoundingClientRect().bottom,
                };
              });
            // Reported at the end so the other routes and widths still run.
            if (Math.abs(gaps.above - gaps.below) >= 3)
              deferred.push(`${engine.name()} ${route} ${width}: unbalanced upload panel gaps ${JSON.stringify(gaps)}`);
          }
          if ([390, 1600, 2560, 3840].includes(width))
            await page.screenshot({
              path: resolve(
                output,
                `${engine.name()}-${route.replaceAll("/", "-")}-${width}.png`,
              ),
              fullPage: true,
            });
          console.log(
            `${engine.name()} ${route} ${width}: OK ${JSON.stringify(metrics)}`,
          );
        }
        await page.emulateMedia({ media: "print" });
        expect(
          await page
            .locator("main")
            .evaluate((el) => getComputedStyle(el).zoom),
        ).toBe("1");
        await page.emulateMedia({ media: "screen" });
        // A short ultrawide window: the sidebar stays viewport-sized and the
        // account actions stay inside it (the menu scrolls if it must).
        await page.setViewportSize({ width: 2560, height: 800 });
        const shortWindow = await page.locator(".sidebar").evaluate((el) => ({
          height: el.getBoundingClientRect().height,
          accountBottom: el.querySelector(".sidebar-bottom").getBoundingClientRect().bottom,
        }));
        expect(shortWindow.height).toBeCloseTo(800, 0);
        expect(shortWindow.accountBottom).toBeLessThanOrEqual(800);
        await page.setViewportSize({ width: 390, height: 844 });
        expect(
          await page
            .locator("main")
            .evaluate((el) => getComputedStyle(el).zoom),
        ).toBe("1");
      }
      await page.close();
    } finally {
      await browser.close();
    }
  }
  console.log(`Screenshots: ${output}`);
  if (deferred.length) {
    console.error(deferred.join("\n"));
    process.exitCode = 1;
  }
} finally {
  await server.close();
}
