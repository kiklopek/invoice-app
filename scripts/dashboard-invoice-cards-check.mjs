// Real React UI + CSS with synthetic read-only HTTP fixtures. No Next auth bootstrap,
// Supabase, mail or billing connections. This is a presentation/browser contract check,
// not a substitute for authenticated Next.js staging E2E.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  invoices,
  scenarioSummary,
  scenarioReport,
  scenarioInvoiceCount,
} from "./dashboard-design-fixtures.mjs";
import { chromium, webkit, expect } from "@playwright/test";

// Vite is already a pinned transitive dependency of Vitest in this project.
const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/config"));
const { createServer } = await import(
  pathToFileURL(vitestRequire.resolve("vite")).href
);

const project = process.cwd();

const revision = process.argv.find((arg) => arg.startsWith("--revision="))?.slice(11);
if (revision && !/^[a-z0-9-]+$/.test(revision)) throw new Error("Invalid revision");
const before = process.argv.includes("--before");
const shellOnly = process.argv.includes("--shell-only");
const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const fixture = resolve(project, `.cache/dashboard-design-fixture-${engine}`);
const browserPort = engine === "webkit" ? 4320 : 4319;
const output = resolve(
  project,
  `artifacts/dashboard-design/${revision || (before ? "before" : shellOnly ? "fluid-routes" : "fluid")}-${engine}`,
);
if (before && existsSync(resolve(output, "results.json"))) {
  throw new Error(
    "The original before baseline already exists; refusing to overwrite it with changed UI.",
  );
}
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });

await writeFile(
  resolve(fixture, "index.html"),
  '<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>',
);
await writeFile(
  resolve(fixture, "link.tsx"),
  `import { createElement } from 'react'; export default function Link({href, children, prefetch: _prefetch, replace: _replace, scroll: _scroll, ...props}) { return createElement('a', {...props, href}, children); }`,
);
await writeFile(
  resolve(fixture, "image.tsx"),
  `import { createElement } from 'react'; export default function Image({priority: _priority, preload: _preload, fill: _fill, unoptimized: _unoptimized, ...props}) { return createElement('img', props); }`,
);
await writeFile(
  resolve(fixture, "navigation.tsx"),
  `import {useSyncExternalStore} from 'react'; function subscribe(callback){window.addEventListener('popstate',callback);return()=>window.removeEventListener('popstate',callback)} export function usePathname(){return useSyncExternalStore(subscribe,()=>window.location.pathname,()=>'/dashboard')} export function useRouter(){return {push:(url)=>window.location.assign(url),replace:(url)=>window.location.replace(url),refresh:()=>{}}} export function useSearchParams(){return new URLSearchParams(window.location.search)}`,
);
await writeFile(
  resolve(fixture, "entry.tsx"),
  `
import {createElement} from 'react'; import {createRoot} from 'react-dom/client';
import '${project}/src/app/globals.css'; import '${project}/src/app/minimal.css';
import '${project}/src/app/styles/responsive.css'; import '${project}/src/app/styles/invoice-cards.css';
import {AppShell,AppFrame} from '${project}/src/components/layout/app-shell';
import {WorkspaceDataProvider} from '${project}/src/components/workspace-data-provider';
import {DashboardClient} from '${project}/src/app/(workspace)/dashboard/dashboard-client';
const scenario=new URLSearchParams(location.search).get('scenario')||'normal';
const profile={role:scenario==='viewer'?'viewer':'admin',name:'Anna Nováková',email:'anna@example.invalid',companyName:'Ukázková společnost s.r.o.'};
const scenarios=${JSON.stringify({ normal: scenarioSummary("normal"), empty: scenarioSummary("empty"), stress: scenarioSummary("stress") })};
const base=scenarios[scenario]||scenarios.normal;
createRoot(document.getElementById('root')).render(createElement(WorkspaceDataProvider,null,createElement(AppShell,{initialProfile:profile},location.pathname==='/dashboard'?createElement(DashboardClient,{initialData:base,initialNow:'2026-10-17T08:00:00.000Z'}):createElement(AppFrame,null,createElement('header',{className:'section-header'},createElement('h1',null,'Kontrola sdíleného rozložení')),createElement('section',{className:'card',style:{minHeight:'1100px'}},createElement('h2',null,'Obsah podstránky'),createElement('p',null,'Prezentace společné navigace a pozadí; obsah konkrétní podstránky není součástí této fixture.'),createElement('button',null,'Ovládací prvek'))))));
`,
);

const server = await createServer({
  configFile: false,
  root: fixture,
  publicDir: resolve(project, "public"),
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    port: browserPort,
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
const browser = await { chromium, webkit }[engine].launch({ headless: true });
const results = [];
try {
 for(const width of [320,360,390,430,600,767,768,1440])for(const scenario of ['normal','stress']){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>{const url=new URL(route.request().url());if(url.pathname==='/api/dashboard')return route.fulfill({json:scenarioSummary(scenario)});if(url.pathname==='/api/reports')return route.fulfill({json:scenarioReport(url)});if(url.pathname==='/api/invoices')return route.fulfill({json:{invoices,total:scenarioInvoiceCount(url,scenario),active_count:25,currencies:['CZK','EUR']}});if(url.pathname==='/api/notifications')return route.fulfill({json:{items:[],total:0,unread_count:0,through:new Date().toISOString(),has_more:false,next_cursor:null}});return route.fulfill({json:{active:true}})});
  await page.goto(`http://127.0.0.1:${browserPort}/dashboard?scenario=${scenario}`);const list=page.getByRole('list',{name:'Poslední faktury',exact:true});
  if(width<768){await expect(list).toBeVisible();expect(await list.getByRole('listitem').count()).toBeGreaterThan(0);const details=await list.getByRole('listitem').evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return{inside:[...card.querySelectorAll('*')].every(el=>{const b=el.getBoundingClientRect();return (!b.width&&!b.height)||(b.left>=r.left-1&&b.right<=r.right+1)}),areas:getComputedStyle(card).gridTemplateAreas}}));expect(details.every(item=>item.inside)).toBe(true);if(width===390&&scenario==='normal')await list.getByRole('listitem').first().screenshot({path:resolve(output,'mobile-invoice-card-390.png')});const link=list.getByRole('link').first();expect(await link.getAttribute('href')).toContain('/invoices/');}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);results.push({width,scenario,passed:true});await page.close();console.log('PASS invoice cards '+width+' '+scenario);
 }
 await writeFile(resolve(output,'invoice-cards-validation.json'),JSON.stringify(results,null,2));
}finally{await browser.close();await server.close()}
