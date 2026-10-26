import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { chromium, webkit, expect } from "@playwright/test";
import { reportsFixture } from "./reports-design-fixtures.mjs";
const project = process.cwd(),
  fixture = resolve(".cache/reports-design"),
  output = resolve("docs/redesign/visual-validation/mobile-reports");
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
  `import React from 'react';import{createRoot}from'react-dom/client';import '${project}/src/app/globals.css';import '${project}/src/app/minimal.css';import '${project}/src/app/styles/responsive.css';import{AppShell}from'${project}/src/components/layout/app-shell';import{WorkspaceDataProvider}from'${project}/src/components/workspace-data-provider';import{ToastProvider}from'${project}/src/components/toast';import{ReportsClient}from'${project}/src/app/(workspace)/reports/reports-client';import{reportsFixture}from'${project}/scripts/reports-design-fixtures.mjs';const q=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<WorkspaceDataProvider><ToastProvider><AppShell initialProfile={{role:q.get('role')||'admin',name:'Tomáš R.',email:'fixture@example.invalid',companyName:'Demo firma s.r.o.',vatPayer:q.get('vat')!=='false'}}><ReportsClient initialData={reportsFixture(q.get('mode')||'populated')} initialFrom="2026-01-01" initialTo="2026-10-23" initialGeneratedAt="2026-10-23T08:00:00Z"/></AppShell></ToastProvider></WorkspaceDataProvider>);`,
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
    port: 4351,
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
const browser = await (process.argv.includes("--webkit") ? webkit : chromium).launch();
const results = [];
async function pageFor(width = 1536, height = 1024, query = "") {
  const page = await browser.newPage({
      viewport: { width, height },
      locale: "cs-CZ",
    }),
    requests = [],
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (url.pathname === "/api/reports") {
      if (url.searchParams.get("format") === "xlsx")
        return route.fulfill({
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          body: "isolated-export",
        });
      return route.fulfill({
        json: reportsFixture(
          url.searchParams.get("currency") === "EUR" ? "eur" : "populated",
        ),
      });
    }
    if (url.pathname === "/api/notifications") return route.fulfill({ json: { items: [], unread_count: 0, total: 0, has_more: false, through: "2026-10-25T10:00:00Z", next_cursor: null } });
    return route.fulfill({
      json: { count: 35, invoices: [], items: [], unread: 0 },
    });
  });
  await page.goto(`http://127.0.0.1:4351/reports${query}`);
  await expect(page.getByRole("tabpanel")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { page, requests, errors };
}
const baseline = process.argv.includes('--baseline');
const viewports=[[320,568],[360,740],[375,812],[390,844],[414,896],[430,932],[480,900],[600,960],[767,1024],[768,1024],[820,1180],[1024,768],[1280,800],[1440,900],[1920,1080]];
const tabs=[['Tržby','revenue'],['DPH','vat'],['Pohledávky','receivables'],['Platby','payments']];
async function check(name,run){await run();results.push({name,passed:true});console.log('PASS '+name)}
try {
 for(const [width,height] of (process.argv.includes("--functional-only") ? [] : viewports)){
  if(baseline&&width<768)continue; if(process.argv.includes("--desktop-only")&&width<768)continue;
  await check(`layout ${width}x${height}`,async()=>{const c=await pageFor(width,height);try{
   await c.page.addStyleTag({content:'[data-esko-launcher],[data-esko-restore]{visibility:hidden!important} *{animation:none!important;transition:none!important}'});
   for(const [label,key] of tabs){await c.page.getByRole('tab',{name:label,exact:true}).click();await expect(c.page.getByRole('tabpanel')).toBeVisible();
    expect(await c.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(width>=768){
     const main=c.page.locator('main');const shot=await main.screenshot();const path=resolve(output,`baseline-${key}-${width}.png`);
     if(baseline)await writeFile(path,shot);else { await writeFile(resolve(output,`current-${key}-${width}.png`),shot); const before = await sharp(await readFile(path)).raw().toBuffer({resolveWithObject:true});const after = await sharp(shot).raw().toBuffer({resolveWithObject:true});expect(after.info).toEqual(before.info);let changed=0;for(let i=0;i<after.data.length;i++)if(Math.abs(after.data[i]-before.data[i])>3)changed++;expect(changed,`${key} ${width} desktop changed`).toBe(0); }
    }else{
     await expect(c.page.getByRole('button',{name:'Otevřít filtry',exact:true})).toBeVisible();
     await expect(c.page.getByRole('button',{name:/Vybrat období:/})).toBeVisible();
     await expect(c.page.locator('main input[type=date]')).toHaveCount(0);
     const cards=c.page.getByRole('group',{name:'Souhrn reportu'});expect(await cards.locator('article:visible').count()).toBe(2);
     const clipped=await cards.locator('article:visible > strong').evaluateAll(nodes=>nodes.filter(el=>{const range=document.createRange();range.selectNodeContents(el);return range.getBoundingClientRect().width>el.getBoundingClientRect().width+1}).map(el=>el.textContent));expect(clipped).toEqual([]);
     await c.page.getByRole('button',{name:'Otevřít filtry',exact:true}).click();const sheet=c.page.getByRole('dialog',{name:'Filtry',exact:true});await expect(sheet).toBeVisible();const box=await sheet.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y+box.height).toBeLessThanOrEqual(height+1);await expect(sheet.getByRole('button',{name:'Použít filtry',exact:true})).toBeInViewport();
     if(width===390&&key==='revenue')await c.page.screenshot({path:resolve(output,'filters-sheet-390.png')});await c.page.keyboard.press('Escape');
     if([320,390,767].includes(width))await c.page.screenshot({path:resolve(output,`${key}-${width}.png`),fullPage:true});
    }
   }expect(c.errors).toEqual([]);
  }finally{await c.page.close()}});
 }

 if(!baseline&&!process.argv.includes("--desktop-only")) {
 for(const [width,height] of [[320,568],[390,844],[767,1024]])await check(`period, filters, focus and short viewport ${width}`,async()=>{
  const c=await pageFor(width,height),page=c.page;
  const calls=()=>c.requests.filter(url=>url.pathname==='/api/reports');
  try{
   const filter=page.getByRole('button',{name:'Otevřít filtry',exact:true});
   await filter.click();let sheet=page.getByRole('dialog',{name:'Filtry',exact:true});await expect(sheet).toBeVisible();
   const before=calls().length;
   await sheet.getByLabel('Měna',{exact:true}).selectOption('EUR');
   await sheet.getByLabel('Stav faktury',{exact:true}).selectOption('overdue');
   await page.waitForTimeout(120);expect(calls().length).toBe(before);
   await page.keyboard.press('Escape');await expect(sheet).toHaveCount(0);await expect(filter).toBeFocused();
   await filter.click();sheet=page.getByRole('dialog',{name:'Filtry',exact:true});await expect(sheet.getByLabel('Měna',{exact:true})).toHaveValue('CZK');
   await sheet.getByLabel('Měna',{exact:true}).selectOption('EUR');
   await sheet.getByLabel('Stav faktury',{exact:true}).selectOption('overdue');
   await sheet.getByLabel('Odběratel',{exact:true}).selectOption('WOOD & PAPER a.s.');
   await sheet.getByLabel('Období podle',{exact:true}).selectOption('due_date');
   await sheet.getByRole('button',{name:'Použít filtry',exact:true}).click();
   await expect(page.getByRole('tabpanel')).toBeVisible();expect(calls().length).toBe(before+1);
   expect(Object.fromEntries(calls().at(-1).searchParams)).toMatchObject({currency:'EUR',status:'overdue',customer:'WOOD & PAPER a.s.',date_basis:'due_date'});
   await expect(filter.locator('span')).toHaveText('4');
   await expect(page.getByRole('group',{name:'Souhrn reportu'})).toContainText('1 210,50 €');
   await page.getByRole('tab',{name:'DPH',exact:true}).click();await expect(filter.locator('span')).toHaveText('4');
   await page.getByRole('tab',{name:'Platby',exact:true}).click();await expect(filter.locator('span')).toHaveCount(0);
   await filter.click();sheet=page.getByRole('dialog',{name:'Filtry',exact:true});await expect(sheet.locator('select')).toHaveCount(0);await expect(sheet).toContainText('Fakturové filtry se neuplatní');await page.keyboard.press('Escape');
   await page.getByRole('tab',{name:'Tržby',exact:true}).click();await expect(filter.locator('span')).toHaveText('4');
   await filter.click();sheet=page.getByRole('dialog',{name:'Filtry',exact:true});
   const resetCalls=calls().length;await sheet.getByRole('button',{name:'Resetovat',exact:true}).click();expect(calls().length).toBe(resetCalls);await expect(sheet.getByLabel('Měna',{exact:true})).toHaveValue('CZK');
   await sheet.getByRole('button',{name:'Použít filtry',exact:true}).click();await expect(page.getByRole('tabpanel')).toBeVisible();await expect(filter.locator('span')).toHaveCount(0);
   for(const label of ['Tento měsíc','Toto čtvrtletí','Tento rok']){
    await page.getByRole('button',{name:/Vybrat období:/}).click();sheet=page.getByRole('dialog',{name:'Vybrat období',exact:true});const n=calls().length;
    await sheet.getByRole('button',{name:label,exact:true}).click();expect(calls().length).toBe(n);
    await sheet.getByRole('button',{name:'Použít',exact:true}).click();await expect(page.getByRole('tabpanel')).toBeVisible();await expect(page.getByRole('button',{name:`Vybrat období: ${label}`,exact:true})).toBeVisible();
   }
   await page.getByRole('button',{name:/Vybrat období:/}).click();sheet=page.getByRole('dialog',{name:'Vybrat období',exact:true});
   await sheet.getByRole('group',{name:'Způsob výběru období'}).getByRole('button',{name:'Vlastní období',exact:true}).click();
   await sheet.getByLabel('Od',{exact:true}).fill('2026-11-02');await sheet.getByLabel('Do',{exact:true}).fill('2026-02-01');
   await expect(sheet.getByRole('alert')).toBeVisible();await expect(sheet.getByRole('button',{name:'Použít',exact:true})).toBeDisabled();
   await sheet.getByLabel('Od',{exact:true}).fill('2026-02-01');await sheet.getByLabel('Do',{exact:true}).fill('2026-03-31');
   await page.setViewportSize({width,height:360});
   const rect=await sheet.boundingBox();expect(rect.y).toBeGreaterThanOrEqual(0);expect(rect.y+rect.height).toBeLessThanOrEqual(361);
   await expect(sheet.getByRole('button',{name:'Použít',exact:true})).toBeInViewport();
   await page.screenshot({path:resolve(output,`period-sheet-${width}.png`)});
   await sheet.getByRole('button',{name:'Použít',exact:true}).click();await expect(page.getByRole('tabpanel')).toBeVisible();expect(calls().at(-1).searchParams.get('from')).toBe('2026-02-01');expect(calls().at(-1).searchParams.get('to')).toBe('2026-03-31');
   await page.setViewportSize({width,height});
   await page.getByRole('button',{name:'Další ukazatele',exact:true}).click();expect(await page.getByRole('group',{name:'Souhrn reportu'}).locator('article:visible').count()).toBe(4);
   await page.getByRole('button',{name:'Skrýt další ukazatele',exact:true}).click();
   const bar=page.getByRole('tabpanel').getByRole('button',{name:/Fakturováno.*Evidované úhrady/}).first();await bar.click();const values=page.getByRole('dialog');await expect(values).toContainText('200 000');await page.keyboard.press('Escape');await expect(bar).toBeFocused();
   expect(c.errors).toEqual([]);
  }finally{await page.close()}
 });
 await check('supported exports, applied filters, PDF print and errors',async()=>{
  const c=await pageFor(390,844),page=c.page;try{
   await page.getByRole('button',{name:'Otevřít filtry',exact:true}).click();let sheet=page.getByRole('dialog',{name:'Filtry',exact:true});await sheet.getByLabel('Stav faktury',{exact:true}).selectOption('overdue');await sheet.getByRole('button',{name:'Použít filtry',exact:true}).click();await expect(page.getByRole('tabpanel')).toBeVisible();
   await page.getByRole('button',{name:'Exportovat report',exact:true}).click();sheet=page.getByRole('dialog',{name:'Exportovat',exact:true});await expect(sheet.getByRole('radio')).toHaveCount(2);await expect(sheet.getByText('CSV',{exact:true})).toHaveCount(0);await sheet.getByRole('radio',{name:/Excel/}).check();
   const [download]=await Promise.all([page.waitForEvent('download'),sheet.getByRole('button',{name:'Exportovat',exact:true}).click()]);expect(download.suggestedFilename()).toContain('.xlsx');const request=c.requests.filter(u=>u.searchParams.get('format')==='xlsx').at(-1);expect(request.searchParams.get('status')).toBe('overdue');expect(request.searchParams.get('from')).toBe('2026-01-01');
   await page.route('**/api/reports?**',route=>new URL(route.request().url()).searchParams.has('format')?route.fulfill({status:500,json:{error:'Export fixture failure'}}):route.fallback());
   await sheet.getByRole('button',{name:'Exportovat',exact:true}).click();await expect(sheet.getByRole('alert')).toHaveText('Export fixture failure');
   await sheet.getByRole('radio',{name:/Tisk \/ PDF/}).check();await page.evaluate(()=>{window.__printed=0;window.print=()=>window.__printed++});
   await page.screenshot({path:resolve(output,'export-sheet-390.png')});await sheet.getByRole('button',{name:'Exportovat',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__printed)).toBe(1);await expect(sheet).toHaveCount(0);
   expect(c.errors).toEqual([]);
  }finally{await page.close()}
 });
 for(const mode of ['empty','negative','changing-aging'])await check(`all report states ${mode}`,async()=>{const c=await pageFor(320,568,`?mode=${mode}`);try{for(const[label]of tabs){await c.page.getByRole('tab',{name:label,exact:true}).click();await expect(c.page.getByRole('tabpanel')).toBeVisible();expect(await c.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}expect(c.errors).toEqual([])}finally{await c.page.close()}});
 }

 await writeFile(resolve(output,baseline?'baseline-results.json':process.argv.includes('--webkit')?'webkit-results.json':'results.json'),JSON.stringify(results,null,2));
}finally{await browser.close();await server.close()}
