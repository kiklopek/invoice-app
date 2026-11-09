import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium, webkit, expect } from "@playwright/test";
const project = process.cwd(),
  fixture = resolve(".cache/customers-responsive"),
  output = resolve("/tmp/customers-responsive-check");
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
  `import React from 'react';import{createRoot}from'react-dom/client';import '${project}/src/app/globals.css';import '${project}/src/app/minimal.css';import '${project}/src/app/styles/responsive.css';import{AppShell}from'${project}/src/components/layout/app-shell';import{WorkspaceDataProvider}from'${project}/src/components/workspace-data-provider';import{ToastProvider}from'${project}/src/components/toast';import{CustomersClient}from'${project}/src/app/(workspace)/customers/customers-client';
const values=[1519373.53,329271.78,106192.02,24141.53,20570,15730,25383.47,12440.05,9115.98,2000000000000.99];
const data={can_manage:true,customers:values.map((value,index)=>({id:String(index),name:index===0?'Ukázková společnost s dlouhým názvem s.r.o.':'Zákazník '+(index+1),ico:'12345678',dic:'CZ12345678',address:'Dlouhá ulice 123, Praha 110 00',email:'fakturace@example.invalid',phone:'+420 123 456 789',total_invoiced:value,outstanding:index===0?1320318.60:value,overdue_amount:value,invoice_count:index===0?12:1,last_invoice_date:'2026-10-29',reminder_policy_name:'Standardní upomínky'}))};
createRoot(document.getElementById('root')).render(<WorkspaceDataProvider><ToastProvider><AppShell initialProfile={{role:'admin',name:'Tomáš R.',email:'fixture@example.invalid',companyName:'Demo firma s.r.o.',vatPayer:true}}><CustomersClient initialData={data}/></AppShell></ToastProvider></WorkspaceDataProvider>);`,
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
    port: 4358,
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

// Use the real customer page and shell with local read-only fixture data.
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/**", (route) =>
        route.fulfill({
          json: {
            items: [],
            unread_count: 0,
            total: 0,
            has_more: false,
            count: 0,
            invoices: [],
          },
        }),
      );
      for (const width of [
        320, 390, 767, 768, 834, 1024, 1180, 1280, 1440, 1920, 2560,
      ]) {
        await page.setViewportSize({
          width,
          height: width < 1024 ? 1100 : 1000,
        });
        await page.goto("http://127.0.0.1:4358/customers");
        await expect(page.locator(".customer-amount")).toHaveCount(20);
        await page.evaluate(() => document.fonts.ready);
        const check = async () =>
          page.evaluate(() => {
            const amounts = [...document.querySelectorAll(".customer-amount")];
            return {
              pageOverflow:
                document.documentElement.scrollWidth > innerWidth + 1,
              scrollers: [
                ...document.querySelectorAll(
                  ".customer-amount, .customer-amount [data-money-visible]",
                ),
              ].filter((el) =>
                ["auto", "scroll"].includes(getComputedStyle(el).overflowX),
              ).length,
              textOverflow: amounts
                .filter((el) => {
                  const visible = el.querySelector("[data-money-visible]");
                  const range = document.createRange();
                  range.selectNodeContents(visible);
                  const text = range.getBoundingClientRect(),
                    box = visible.getBoundingClientRect();
                  return text.width > box.width + 1 || text.left < box.left - 1;
                })
                .map((el) => el.textContent),
            };
          });
        await expect
          .poll(check)
          .toEqual({ pageOverflow: false, scrollers: 0, textOverflow: [] });
        const compact = page.locator('.customer-amount[tabindex="0"]').first();
        if (await compact.count()) {
          const exact = await compact.getAttribute("aria-label");
          await compact.click();
          await expect(page.getByRole("tooltip")).toHaveText(exact);
          await page.keyboard.press("Escape");
          await expect(page.getByRole("tooltip")).toHaveCount(0);
        }
        await page.mouse.move(0, 0);
        await page.locator(".customers-search-field input").focus();
        await expect(page.getByRole("tooltip")).toHaveCount(0);
        if ([390, 834, 1440].includes(width))
          await page.screenshot({
            path: resolve(output, `${engine.name()}-${width}.png`),
            fullPage: true,
          });
        if (width === 390) {
          await page.addStyleTag({
            content:
              ".customer-billing-cell strong, .outstanding-badge {font-size:28px !important}",
          });
          await expect
            .poll(check)
            .toEqual({ pageOverflow: false, scrollers: 0, textOverflow: [] });
        }
        expect(errors).toEqual([]);
        console.log(
          `${engine.name()} ${width}px: no scrollbars or overflowing amounts; exact-value tooltip OK`,
        );
      }
      await page.getByRole("searchbox").fill("Ukázková společnost");
      await expect(page.locator(".customers-list-table tbody tr")).toHaveCount(
        1,
      );
      await expect(page.locator(".customer-invoices-link")).toHaveAttribute(
        "href",
        `/invoices?q=${encodeURIComponent("Ukázková společnost s dlouhým názvem s.r.o.")}`,
      );
    } finally {
      await browser.close();
    }
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await server.close();
}
