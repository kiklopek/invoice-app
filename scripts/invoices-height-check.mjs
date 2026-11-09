import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium, webkit, expect } from "@playwright/test";
import {
  invoicePage,
  invoicePagingRows,
  invoiceTotals,
  initialQuery,
} from "./invoices-design-fixtures.mjs";
const project = process.cwd(),
  fixture = resolve(project, ".cache/invoices-height");
const output = resolve(project, "/tmp/invoices-height-check");
const before = process.argv.includes("--before");
if (before && existsSync(resolve(output, "before.png")))
  throw new Error("Before baseline already exists");
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });
await writeFile(
  resolve(fixture, "index.html"),
  '<html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>',
);
await writeFile(
  resolve(fixture, "link.tsx"),
  `import {createElement} from 'react';export default function Link({href,children,prefetch:_p,...props}){return createElement('a',{...props,href},children)}`,
);
await writeFile(
  resolve(fixture, "image.tsx"),
  `import {createElement} from 'react';export default function Image({src,alt,unoptimized:_u,preload:_pr,priority:_pi,fill:_f,...props}){return createElement('img',{...props,src,alt})}`,
);
await writeFile(
  resolve(fixture, "navigation.tsx"),
  `export function usePathname(){return location.pathname}export function useRouter(){return {push:url=>location.assign(url),replace:url=>location.replace(url),prefetch:()=>{},refresh:()=>{}}}export function useSearchParams(){return new URLSearchParams(location.search)}`,
);
await writeFile(
  resolve(fixture, "entry.tsx"),
  `
import {createElement} from 'react';import{createRoot}from'react-dom/client';
import '${project}/src/app/globals.css';import '${project}/src/app/minimal.css';import '${project}/src/app/styles/responsive.css';import '${project}/src/app/styles/invoice-cards.css';
import{AppShell,AppFrame}from'${project}/src/components/layout/app-shell';import{WorkspaceDataProvider}from'${project}/src/components/workspace-data-provider';import{ToastProvider}from'${project}/src/components/toast';import{InvoicesClient}from'${project}/src/app/(workspace)/invoices/invoices-client';
const scenario=new URLSearchParams(location.search).get('scenario')||'normal';const data=${JSON.stringify({ normal: invoicePage(), viewer: invoicePage(undefined, "viewer"), empty: invoicePage(undefined, "empty"), stress: invoicePage(undefined, "stress"), paging: invoicePage(undefined, "paging", invoicePagingRows) })};
const initialSums=${JSON.stringify({ normal: invoiceTotals(), viewer: invoiceTotals(undefined, "viewer"), empty: invoiceTotals(undefined, "empty"), stress: invoiceTotals(undefined, "stress"), paging: invoiceTotals(undefined, "paging", invoicePagingRows) })};
const params=new URLSearchParams(location.search);const stored=document.cookie.split('; ').find(item=>item.startsWith('splatno-invoices-page-size='))?.split('=')[1];const size=Number(params.get('page_size')||stored||25);const selectedSize=[10,25,50,100].includes(size)?size:25;
const selectedData={...(data[scenario]||data.normal),page_size:selectedSize};const selectedQuery={...${JSON.stringify(initialQuery)},pageSize:selectedSize};const selectedKey='/api/invoices?paged=1&page=1'+(selectedSize===25?'':'&page_size='+selectedSize);
const profile={role:scenario==='viewer'?'viewer':'admin',name:'Tomáš Adamec',email:'tomas@example.invalid',companyName:'Demo firma s.r.o.'};
createRoot(document.getElementById('root')).render(createElement(WorkspaceDataProvider,null,createElement(ToastProvider,null,createElement(AppShell,{initialProfile:profile},location.pathname==='/invoices'?createElement(InvoicesClient,{initialData:selectedData,initialTotals:initialSums[scenario]||initialSums.normal,initialQuery:selectedQuery,initialKey:selectedKey,initialNow:'2026-10-19T08:00:00Z'}):createElement(AppFrame,null,createElement('h1',null,'Cílová stránka'))))));`,
);
const require = createRequire(import.meta.url),
  vr = createRequire(require.resolve("vitest/config"));
const { createServer } = await import(pathToFileURL(vr.resolve("vite")).href);
const server = await createServer({
  configFile: false,
  root: fixture,
  publicDir: resolve(project, "public"),
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: 4360,
    strictPort: true,
    fs: { allow: [project] },
  },
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: [
      { find: /^next\/link$/, replacement: resolve(fixture, "link.tsx") },
      { find: /^next\/image$/, replacement: resolve(fixture, "image.tsx") },
      {
        find: /^next\/navigation$/,
        replacement: resolve(fixture, "navigation.tsx"),
      },
      { find: "@", replacement: resolve(project, "src") },
    ],
    dedupe: ["react", "react-dom"],
  },
});
await server.listen();
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      await page.route("**/api/**", (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/invoices/totals")
          return route.fulfill({ json: invoiceTotals(url) });
        if (url.pathname === "/api/invoices")
          return route.fulfill({ json: invoicePage(url) });
        return route.fulfill({
          json: { items: [], count: 0, unread_count: 0 },
        });
      });
      for (const scenario of ["normal", "empty", "paging"]) {
        for (const [width, height] of [
          [390, 844],
          [768, 1024],
          [1280, 800],
          [1920, 1080],
          [2560, 1440],
          [1920, 1600],
        ]) {
          await page.setViewportSize({ width, height });
          await page.goto(
            `http://127.0.0.1:4360/invoices?scenario=${scenario}&page_size=10`,
          );
          await expect(page.locator("[data-invoice-pagination]")).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          const metrics = await page.evaluate(() => {
            const nav = document.querySelector("[data-invoice-pagination]");
            const panel = nav.parentElement.getBoundingClientRect();
            const main = document.querySelector("main").getBoundingClientRect();
            return {
              panelBottom: panel.bottom,
              mainBottom: main.bottom,
              viewport: innerHeight,
              overflow: document.documentElement.scrollWidth > innerWidth + 1,
              footerBottom: nav.getBoundingClientRect().bottom,
            };
          });
          expect(metrics.overflow).toBe(false);
          if (width >= 768) {
            expect(metrics.panelBottom).toBeGreaterThanOrEqual(height - 1);
            expect(
              Math.abs(metrics.panelBottom - metrics.mainBottom),
            ).toBeLessThanOrEqual(1);
            expect(
              Math.abs(metrics.panelBottom - metrics.footerBottom),
            ).toBeLessThanOrEqual(2);
          }
          if (scenario === "normal" && [390, 1920, 2560].includes(width))
            await page.screenshot({
              path: resolve(output, `${engine.name()}-${width}x${height}.png`),
              fullPage: true,
            });
          console.log(
            `${engine.name()} ${scenario} ${width}x${height}: ${JSON.stringify(metrics)}`,
          );
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
