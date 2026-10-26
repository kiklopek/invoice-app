import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const project = process.cwd(),
  fixture = resolve(".cache/mobile-header-design"),
  output = resolve("docs/redesign/visual-validation/mobile-header");
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
  "export function usePathname(){return location.pathname}export function useRouter(){return{push:url=>{window.testNavigation=url},replace:url=>location.replace(url),prefetch:()=>{},refresh:()=>{}}}export function useSearchParams(){return new URLSearchParams(location.search)}",
);
await writeFile(
  resolve(fixture, "entry.tsx"),
  `
import React from'react';import{createRoot}from'react-dom/client';import'${project}/src/app/globals.css';import'${project}/src/app/minimal.css';import'${project}/src/app/styles/responsive.css';import{AppShell,AppFrame}from'${project}/src/components/layout/app-shell';import{WorkspaceDataProvider}from'${project}/src/components/workspace-data-provider';import{ToastProvider}from'${project}/src/components/toast';import{NotificationsClient}from'${project}/src/app/(workspace)/notifications/notifications-client';const params=new URLSearchParams(location.search);const user=params.get('user')||'a';const role=params.get('role')||'admin';createRoot(document.getElementById('root')).render(<WorkspaceDataProvider key={user}><ToastProvider><AppShell initialProfile={{role,name:params.has('longProfile')?'VelmiDlouhéJménoUživatele'.repeat(4):'Tomáš R.',email:user+'@example.invalid',companyName:params.has('longProfile')?'DlouhýNázevSpolečnosti'.repeat(6):'Demo firma s.r.o.',vatPayer:true}}>{location.pathname==='/notifications'?<NotificationsClient/>:<AppFrame invoiceCount={35} className="content section-page"><h1>Nástěnka</h1><p>Testovací prostředí oznámení. Žádné produkční zápisy.</p>{params.has('orientationTest')&&<input aria-label="Rozpracovaný údaj" defaultValue=""/>}</AppFrame>}</AppShell></ToastProvider></WorkspaceDataProvider>);`,
);
const require = createRequire(import.meta.url),
  vr = createRequire(require.resolve("vitest/config"));
const { createServer } = await import(pathToFileURL(vr.resolve("vite")).href);
const server = await createServer({
  configFile: false,
  root: fixture,
  publicDir: resolve("public"),
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: 4361,
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
const browser = await chromium.launch();
const results = [];
const id = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const fixtureItems = () => [
  {
    id: id(1),
    type: "invoice_overdue",
    title: "Faktura po splatnosti",
    message: "Faktura č. 1443260143 je po splatnosti (WOOD & PAPER a.s.).",
    href: "/invoices/" + id(101),
    created_at: new Date(Date.now() - 7200000).toISOString(),
    read_at: null,
  },
  {
    id: id(2),
    type: "payment_unmatched",
    title: "Nespárovaná platba",
    message: "Zaevidovaná platba 25 000 Kč vyžaduje kontrolu párování.",
    href:
      "/invoices/payments/archive?highlight=" + id(102) + "#payment-" + id(102),
    created_at: new Date(Date.now() - 14400000).toISOString(),
    read_at: null,
  },
  {
    id: id(3),
    type: "reminder_failed",
    title: "Odeslání upomínky selhalo",
    message:
      "Upomínka k faktuře č. 1443245789 vyžaduje kontrolu v detailu faktury.",
    href: "/invoices/" + id(103),
    created_at: new Date(Date.now() - 86400000).toISOString(),
    read_at: new Date().toISOString(),
  },
  {
    id: id(4),
    type: "invoice_paid",
    title: "Faktura uhrazena",
    message: "Faktura č. 2026004 byla plně uhrazena (DEF Company s.r.o.).",
    href: "/invoices/" + id(104),
    created_at: new Date(Date.now() - 259200000).toISOString(),
    read_at: new Date().toISOString(),
  },
];
async function setup(width = 1536, options = {}) {
  const page = await browser.newPage({
      viewport: { width, height: options.height ?? (width <= 390 ? 568 : 1024) },
      ...(options.phone ? { isMobile: true, hasTouch: true } : {}),
    }),
    errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("PAGEERROR", e.message);
  });
  let items = options.empty ? [] : fixtureItems();
  if (options.long)
    items = items.map((item) => ({
      ...item,
      title: item.title + " " + "VelmiDlouhéČísloFaktury".repeat(4),
      message: item.message + " " + "DlouhýNázevOdběrateleBezMezer".repeat(6),
    }));
  if (options.history)
    items = Array.from({ length: 45 }, (_, i) => ({
      ...fixtureItems()[i % 4],
      id: id(i + 1),
    }));
  const reads = new Map(),
    state = {
      failGet: false,
      failPatch: false,
      delay: false,
      patches: 0,
      gets: 0,
    };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/search")
      return route.fulfill({
        json: {
          results: [
            {
              id: id(101),
              type: "invoice",
              title: "Faktura 2026001",
              subtitle: "WOOD & PAPER a.s.",
              href: "/invoices/" + id(101),
            },
          ],
          unavailable: [],
        },
      });
    if (url.pathname != "/api/notifications")
      return route.fulfill({ json: { items: [], invoices: [], count: 0 } });
    const user = new URL(page.url()).searchParams.get("user") || "a";
    const read = reads.get(user) || new Set();
    reads.set(user, read);
    if (route.request().method() === "PATCH") {
      state.patches++;
      if (state.failPatch)
        return route.fulfill({ status: 500, json: { error: "read failed" } });
      const body = route.request().postDataJSON();
      items
        .filter((i) =>
          body.all ? i.created_at <= body.through : body.ids.includes(i.id),
        )
        .forEach((i) => read.add(i.id));
      return route.fulfill({ json: { changed: read.size } });
    }
    state.gets++;
    if (state.delay) await new Promise((r) => setTimeout(r, 600));
    if (state.failGet)
      return route.fulfill({ status: 503, json: { error: "unavailable" } });
    const all = items.map((i) => ({
      ...i,
      read_at: read.has(i.id) ? new Date().toISOString() : i.read_at,
    }));
    const selected =
      url.searchParams.get("unread") === "true"
        ? all.filter((i) => !i.read_at)
        : all;
    const offset = Number(url.searchParams.get("cursor") || 0),
      limit = Number(url.searchParams.get("limit") || 8);
    return route.fulfill({
      json: {
        preview: Boolean(options.long),
        items: selected.slice(offset, offset + limit),
        unread_count: all.filter((i) => !i.read_at).length,
        total: selected.length,
        through: new Date().toISOString(),
        has_more: selected.length > offset + limit,
        next_cursor:
          selected.length > offset + limit ? String(offset + limit) : null,
      },
    });
  });
  await page.goto(
    "http://127.0.0.1:4361" +
      (options.path ?? (options.history ? "/notifications" : "/dashboard")) +
      (options.role ? "?role=" + options.role + "&longProfile=true" : ""),
  );
  return {
    page,
    state,
    errors,
    reads,
    setItems: (value) => {
      items = value;
    },
  };
}
async function check(name, run) {
  await run();
  results.push({ name, passed: true });
  console.log("PASS " + name);
}
try {
 if(process.argv.includes('--mobile-actions')){
  for(const width of [320,390,767,768,1440])for(const path of ['/dashboard','/invoices','/invoices/payments','/invoices/import','/reports'])await check(`toolbar actions ${path} ${width}`,async()=>{
   const c=await setup(width,{path});try{
    const actions=c.page.locator('[data-workspace-topbar] a[href="/invoices/import"], [data-workspace-topbar] a[href="/invoices/new"]');
    if(width>=768||path==='/dashboard'){
     await expect(actions).toHaveCount(2);for(const action of await actions.all())await expect(action).toBeVisible();
    }else{
     await expect(c.page.locator('[data-workspace-topbar]')).toBeHidden();
     await expect(actions).toHaveCount(0);
     await expect(c.page.locator('.mobile-header-notifications')).toBeAttached();
     await expect(c.page.getByTitle('Oznámení',{exact:true})).toBeVisible();
    }
    expect(c.errors).toEqual([]);
    if(width===390&&['/dashboard','/invoices'].includes(path))await c.page.screenshot({path:resolve(output,`actions-${path.slice(1)}-${width}.png`)});
   }finally{await c.page.close()}
  });
  await check('phone keyboard, landscape guard, Escape and retained draft',async()=>{
   const c=await setup(390,{height:844,phone:true,path:'/invoices?orientationTest=1'});try{
    const input=c.page.getByRole('textbox',{name:'Rozpracovaný údaj',exact:true});await input.fill('Neuložená hodnota');
    const cdp=await c.page.context().newCDPSession(c.page);
    const metrics=(width,height,screenWidth,screenHeight,type,angle)=>cdp.send('Emulation.setDeviceMetricsOverride',{width,height,screenWidth,screenHeight,mobile:true,deviceScaleFactor:1,screenOrientation:{type,angle}});
    await metrics(390,240,390,844,'portraitPrimary',0);
    await expect(c.page.getByRole('dialog',{name:'Otočte telefon na výšku'})).toHaveCount(0);
    await metrics(844,390,844,390,'landscapePrimary',90);
    const guard=c.page.getByRole('dialog',{name:'Otočte telefon na výšku',exact:true});await expect(guard).toBeVisible();
    const box=await guard.boundingBox();expect(box.width).toBe(844);expect(box.height).toBe(390);
    await c.page.keyboard.press('Escape');await expect(guard).toBeVisible();
    await c.page.screenshot({path:resolve(output,'phone-landscape-guard.png')});
    await metrics(390,844,390,844,'portraitPrimary',0);await expect(guard).toHaveCount(0);
    await expect(input).toHaveValue('Neuložená hodnota');
    expect(c.errors).toEqual([]);
   }finally{await c.page.close()}
  });
  for(const [width,height,phone] of [[844,390,false],[1024,768,true]])await check(`desktop/tablet landscape stays available ${width}`,async()=>{
   const c=await setup(width,{height,phone,path:'/dashboard'});try{
    await expect(c.page.getByRole('dialog',{name:'Otočte telefon na výšku'})).toHaveCount(0);expect(c.errors).toEqual([]);
   }finally{await c.page.close()}
  });
  await writeFile(resolve(output,'mobile-actions-validation.json'),JSON.stringify(results,null,2));
 }else{
  const baseline = process.argv.includes("--baseline");
  for (const width of [768, 800, 1023, 1024, 1280, 1440, 1920]) {
    const c = await setup(width);
    try {
      await expect(
        c.page.getByTitle("Oznámení", { exact: true }),
      ).toHaveAttribute("aria-label", /2 nepřečtených/);
      await c.page.evaluate(() => document.fonts.ready);
      await c.page.addStyleTag({
        content: "[data-esko-assistant]{visibility:hidden!important}",
      });
      const rects = await c.page
        .locator("[data-workspace-topbar],.mobile-navigation-bar,.sidebar")
        .evaluateAll((nodes) =>
          nodes.map((n) => {
            const r = n.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }),
        );
      await writeFile(
        resolve(output, `${baseline ? "before" : "after"}-${width}.json`),
        JSON.stringify(rects),
      );
      await c.page.screenshot({
        path: resolve(output, `${baseline ? "before" : "after"}-${width}.png`),
        clip: { x: 0, y: 0, width, height: 180 },
      });
    } finally {
      await c.page.close();
    }
  }

  if (!baseline) {
    const { readFile } = await import("node:fs/promises");
    for (const width of [768, 800, 1023, 1024, 1280, 1440, 1920]) {
      expect(
        await readFile(resolve(output, `after-${width}.json`), "utf8"),
      ).toBe(await readFile(resolve(output, `before-${width}.json`), "utf8"));
    }
    for (const width of [320, 360, 375, 390, 414, 430, 480, 600, 767]) {
      await check(
        `mobile ${width}px: layout, drawer, focus, notifications and navigation`,
        async () => {
          const c = await setup(width, { long: true });
          const page = c.page;
          try {
            const toggle = page.getByRole("button", {
              name: "Otevřít navigaci",
              exact: true,
            });
            await expect(toggle).toBeVisible();
            await expect(page.locator('[data-workspace-topbar] form[role="search"]')).toHaveCount(0);
            await expect(page.locator(".small-mobile-wordmark")).toBeVisible();
            const bell = page.getByTitle("Oznámení", { exact: true });
            await expect(bell).toHaveAttribute("aria-label", /2 nepřečtených/);
            expect(
              await bell.evaluate((n) =>
                Boolean(n.closest(".mobile-navigation-bar")),
              ),
            ).toBe(true);
            const header = await page
              .locator(".mobile-navigation-bar")
              .boundingBox();
            expect(header.height).toBeGreaterThanOrEqual(60);
            expect(header.height).toBeLessThanOrEqual(88);
            const controlSize = await toggle.evaluate(n => n.getBoundingClientRect().width);
            expect(controlSize).toBeGreaterThanOrEqual(44);
            expect(controlSize).toBeLessThanOrEqual(64);
            if (width >= 414) expect(controlSize).toBeGreaterThan(44);
            const centers = await page
              .locator(
                ".mobile-navigation-brand,.small-mobile-search-toggle,.small-mobile-avatar,.mobile-header-notifications summary,.mobile-navigation-toggle",
              )
              .evaluateAll((nodes) =>
                nodes.map((n) => {
                  const r = n.getBoundingClientRect();
                  return r.y + r.height / 2;
                }),
              );
            for (const center of centers)
              expect(
                Math.abs(center - (header.y + header.height / 2)),
              ).toBeLessThanOrEqual(0.5);
            const searchToggle = page.getByRole("button", {
              name: "Otevřít vyhledávání",
            });
            await searchToggle.click();
            const searchDialog = page.getByRole("dialog", {
              name: "Vyhledávání",
              exact: true,
            });
            await expect(searchDialog).toBeVisible();
            const searchInput = searchDialog.getByRole("combobox");
            await expect(searchInput).toBeFocused();
            await searchInput.fill("WOOD");
            await expect(searchDialog.getByRole("option")).toHaveCount(1);
            const searchBounds = await searchDialog.boundingBox();
            expect(searchBounds.x).toBeGreaterThanOrEqual(0);
            expect(searchBounds.x + searchBounds.width).toBeLessThanOrEqual(
              width,
            );
            expect(
              await searchDialog.evaluate(
                (n) => n.scrollWidth <= n.clientWidth,
              ),
            ).toBe(true);
            await page.screenshot({
              animations: "disabled",
              path: resolve(output, `search-${width}.png`),
            });
            await page.keyboard.press("Escape");
            await expect(searchDialog).not.toBeVisible();
            await expect(searchToggle).toBeFocused();
            await searchToggle.click();
            await searchDialog
              .getByRole("button", { name: "Zavřít vyhledávání" })
              .click();
            await expect(searchToggle).toBeFocused();

            const controls = page.locator(
              ".small-mobile-search-toggle,.small-mobile-avatar,.mobile-header-notifications summary,.mobile-navigation-toggle",
            );
            for (const box of await controls.evaluateAll((ns) =>
              ns.map((n) => {
                const r = n.getBoundingClientRect();
                return {
                  width: r.width,
                  height: r.height,
                  right: r.right,
                  left: r.left,
                };
              }),
            )) {
              expect(box.width).toBeGreaterThanOrEqual(44);
              expect(box.height).toBeGreaterThanOrEqual(44);
              expect(box.left).toBeGreaterThanOrEqual(0);
              expect(box.right).toBeLessThanOrEqual(width);
            }
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeLessThanOrEqual(width);
            await page.screenshot({
              animations: "disabled",
              path: resolve(output, `header-${width}.png`),
            });
            await toggle.click();
            const drawer = page.getByRole("dialog", {
              name: "Navigace aplikace",
            });
            await expect(drawer).toBeVisible();
            await expect(page.locator("body")).toHaveClass(
              /mobile-navigation-lock/,
            );
            await expect(page.locator("#obsah")).toHaveAttribute("inert", "");
            await expect(
              drawer.getByRole("link", { name: "Faktury", exact: false }),
            ).toContainText("35");
            const profile = await drawer
              .locator(".mobile-navigation-profile")
              .boundingBox();
            const nav = await drawer.getByRole("navigation").boundingBox();
            expect(profile.y).toBeLessThan(nav.y);
            await expect(
              drawer.getByRole("button", { name: "Odhlásit se", exact: true }),
            ).toHaveCount(1);
            await expect
              .poll(() =>
                drawer.evaluate((n) => n.contains(document.activeElement)),
              )
              .toBe(true);
            await page.keyboard.press("Shift+Tab");
            expect(
              await drawer.evaluate((n) => n.contains(document.activeElement)),
            ).toBe(true);
            await page.screenshot({
              animations: "disabled",
              path: resolve(output, `drawer-${width}.png`),
            });
            await page.keyboard.press("Escape");
            await expect(drawer).not.toBeVisible();
            await expect(toggle).toBeFocused();
            await page
              .getByRole("button", { name: "Otevřít účet a firmu" })
              .click();
            await expect(drawer).toBeVisible();
            await drawer.getByRole("button", { name: "Zavřít menu" }).click();
            await expect(
              page.getByRole("button", { name: "Otevřít účet a firmu" }),
            ).toBeFocused();
            await toggle.click();
            await page
              .locator(".mobile-navigation-backdrop")
              .click({ position: { x: 2, y: 150 } });
            await expect(drawer).not.toBeVisible();
            await bell.click();
            const notifications = page.getByRole("region", {
              name: "Panel oznámení",
            });
            await expect(notifications).toBeVisible();
            const bounds = await notifications.boundingBox();
            expect(bounds.x).toBeGreaterThanOrEqual(0);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
            expect(bounds.y + bounds.height).toBeLessThanOrEqual(
              page.viewportSize().height,
            );
            expect(
              await notifications.evaluate(
                (n) => n.scrollWidth <= n.clientWidth,
              ),
            ).toBe(true);
            await page.screenshot({
              animations: "disabled",
              path: resolve(output, `notifications-${width}.png`),
            });
            await page
              .getByRole("link", { name: /Faktura po splatnosti/ })
              .click();
            await expect
              .poll(() => page.evaluate(() => window.testNavigation))
              .toBe("/invoices/" + id(101));
            await bell.click();
            await page
              .getByRole("button", { name: "Vše jako přečtené" })
              .click();
            await expect(bell).toHaveAttribute("aria-label", "Oznámení");
            await page
              .getByRole("button", { name: "Zavřít panel oznámení" })
              .click();
            await expect(bell).toBeFocused();
            await toggle.click();
            await drawer
              .getByRole("link", { name: "Zákazníci", exact: true })
              .click();
            await expect
              .poll(() => new URL(page.url()).pathname)
              .toBe("/customers");
            await expect(
              page.getByRole("dialog", { name: "Navigace aplikace" }),
            ).not.toBeVisible();
            expect(c.errors).toEqual([]);
          } finally {
            await page.close();
          }
        },
      );
    }
    await check(
      "drawer closes when entering tablet breakpoint; reduced motion",
      async () => {
        const c = await setup(390);
        try {
          await c.page.emulateMedia({ reducedMotion: "reduce" });
          await c.page
            .getByRole("button", { name: "Otevřít navigaci", exact: true })
            .click();
          expect(
            await c.page
              .locator(".mobile-navigation-panel")
              .evaluate((n) => getComputedStyle(n).transitionDuration),
          ).toBe("0s");
          await c.page.setViewportSize({ width: 768, height: 1024 });
          await expect(
            c.page.getByRole("dialog", { name: "Navigace aplikace" }),
          ).not.toBeVisible();
          await expect(c.page.locator("body")).not.toHaveClass(
            /mobile-navigation-lock/,
          );
        } finally {
          await c.page.close();
        }
      },
    );
    for (const role of ["viewer", "accounting", "admin"])
      await check(
        `mobile ${role}: authorized navigation, long profile and logout confirmation`,
        async () => {
          const c = await setup(320, { role });
          try {
            await c.page
              .getByRole("button", { name: "Otevřít navigaci", exact: true })
              .click();
            const drawer = c.page.getByRole("dialog", {
              name: "Navigace aplikace",
            });
            await expect(
              drawer.locator(".mobile-navigation-profile"),
            ).toContainText("DlouhýNázevSpolečnosti");
            expect(
              await drawer.evaluate((n) => n.scrollWidth <= n.clientWidth),
            ).toBe(true);
            const hrefs = await drawer
              .locator("nav a")
              .evaluateAll((ns) => ns.map((n) => n.getAttribute("href")));
            if (role === "viewer") {
              expect(hrefs).not.toContain("/settings");
              expect(hrefs).not.toContain("/reminders");
            }
            await drawer
              .getByRole("button", { name: "Odhlásit se", exact: true })
              .click();
            const confirm = c.page.getByRole("dialog", {
              name: "Opravdu se chcete odhlásit?",
            });
            await expect(confirm).toBeVisible();
            await c.page.keyboard.press("Escape");
            await expect(confirm).not.toBeVisible();
            await expect(drawer).toBeVisible();
          } finally {
            await c.page.close();
          }
        },
      );
    await check(
      "mobile search routes to the selected invoice and closes",
      async () => {
        const c = await setup(390);
        try {
          await c.page
            .getByRole("button", { name: "Otevřít vyhledávání" })
            .click();
          const dialog = c.page.getByRole("dialog", {
            name: "Vyhledávání",
            exact: true,
          });
          await dialog.getByRole("combobox").fill("2026001");
          await dialog.getByRole("link", { name: /Faktura 2026001/ }).click();
          await expect
            .poll(() => new URL(c.page.url()).pathname)
            .toBe("/invoices/" + id(101));
          await expect(
            c.page.getByRole("dialog", { name: "Vyhledávání", exact: true }),
          ).not.toBeVisible();
          expect(c.errors).toEqual([]);
        } finally {
          await c.page.close();
        }
      },
    );
    const { default: sharp } = await import("sharp");
    for (const width of [768, 800, 1023, 1024, 1280, 1440, 1920]) {
      const region = {
        left: 0,
        top: 0,
        width,
        height: width < 1024 ? 80 : 160,
      };
      const before = await sharp(resolve(output, `before-${width}.png`))
        .extract(region)
        .raw()
        .toBuffer();
      const after = await sharp(resolve(output, `after-${width}.png`))
        .extract(region)
        .raw()
        .toBuffer();
      // Chromium can round antialiased border pixels by one channel value.
      expect(after.length).toBe(before.length);
      expect(
        after.every((value, index) => Math.abs(value - before[index]) <= 1),
      ).toBe(true);
    }
    results.push({
      name: "768–1920px header pixel and geometry comparison",
      passed: true,
    });
    await writeFile(
      resolve(output, "validation.json"),
      JSON.stringify(results, null, 2),
    );
  }
 }
} finally {
  await browser.close();
  await server.close();
}
