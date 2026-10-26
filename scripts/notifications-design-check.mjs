import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const project = process.cwd(),
  fixture = resolve(".cache/notifications-design"),
  output = resolve("docs/redesign/visual-validation/notifications");
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
await writeFile(resolve(fixture,"entry.tsx"),`
import React from'react';import{createRoot}from'react-dom/client';import'${project}/src/app/globals.css';import'${project}/src/app/minimal.css';import'${project}/src/app/styles/responsive.css';import{AppShell,AppFrame}from'${project}/src/components/layout/app-shell';import{WorkspaceDataProvider}from'${project}/src/components/workspace-data-provider';import{ToastProvider}from'${project}/src/components/toast';import{NotificationsClient}from'${project}/src/app/(workspace)/notifications/notifications-client';const user=new URLSearchParams(location.search).get('user')||'a';createRoot(document.getElementById('root')).render(<WorkspaceDataProvider key={user}><ToastProvider><AppShell initialProfile={{role:'admin',name:'Tomáš R.',email:user+'@example.invalid',companyName:'Demo firma s.r.o.',vatPayer:true}}>{location.pathname==='/notifications'?<NotificationsClient/>:<AppFrame className="content section-page"><h1>Nástěnka</h1><p>Testovací prostředí oznámení. Žádné produkční zápisy.</p></AppFrame>}</AppShell></ToastProvider></WorkspaceDataProvider>);`);
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
    port: 4356,
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
const browser=await chromium.launch();const results=[];
const id=i=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
const fixtureItems=()=>[
 {id:id(1),type:'invoice_overdue',title:'Faktura po splatnosti',message:'Faktura č. 1443260143 je po splatnosti (WOOD & PAPER a.s.).',href:'/invoices/'+id(101),created_at:new Date(Date.now()-7200000).toISOString(),read_at:null},
 {id:id(2),type:'payment_unmatched',title:'Nespárovaná platba',message:'Zaevidovaná platba 25 000 Kč vyžaduje kontrolu párování.',href:'/invoices/payments/archive?highlight='+id(102)+'#payment-'+id(102),created_at:new Date(Date.now()-14400000).toISOString(),read_at:null},
 {id:id(3),type:'reminder_failed',title:'Odeslání upomínky selhalo',message:'Upomínka k faktuře č. 1443245789 vyžaduje kontrolu v detailu faktury.',href:'/invoices/'+id(103),created_at:new Date(Date.now()-86400000).toISOString(),read_at:new Date().toISOString()},
 {id:id(4),type:'invoice_paid',title:'Faktura uhrazena',message:'Faktura č. 2026004 byla plně uhrazena (DEF Company s.r.o.).',href:'/invoices/'+id(104),created_at:new Date(Date.now()-259200000).toISOString(),read_at:new Date().toISOString()},
];
async function setup(width=1536,options={}){
 const page=await browser.newPage({viewport:{width,height:width<=390?568:1024}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGEERROR',e.message)});
 let items=options.empty?[]:fixtureItems();if(options.long)items=items.map((item,index)=>({...item,href:index%2?item.href:null,title:item.title+' '+('VelmiDlouhéČísloFaktury'.repeat(4)),message:item.message+' '+('DlouhýNázevOdběrateleBezMezer'.repeat(6))}));if(options.history)items=Array.from({length:45},(_,i)=>({...fixtureItems()[i%4],id:id(i+1)}));
 const reads=new Map(),state={failGet:false,failPatch:false,delay:false,patches:0,gets:0};
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());if(url.pathname!='/api/notifications')return route.fulfill({json:{items:[],invoices:[],count:0}});
  const user=new URL(page.url()).searchParams.get('user')||'a';const read=reads.get(user)||new Set();reads.set(user,read);
  if(route.request().method()==='PATCH'){
   state.patches++;if(state.failPatch)return route.fulfill({status:500,json:{error:'read failed'}});
   const body=route.request().postDataJSON();items.filter(i=>body.all?i.created_at<=body.through:body.ids.includes(i.id)).forEach(i=>read.add(i.id));return route.fulfill({json:{changed:read.size}});
  }
  state.gets++;if(state.delay)await new Promise(r=>setTimeout(r,600));if(state.failGet)return route.fulfill({status:503,json:{error:'unavailable'}});
  const all=items.map(i=>({...i,read_at:read.has(i.id)?new Date().toISOString():i.read_at}));const selected=url.searchParams.get('unread')==='true'?all.filter(i=>!i.read_at):all;const offset=Number(url.searchParams.get('cursor')||0),limit=Number(url.searchParams.get('limit')||8);
  return route.fulfill({json:{preview:Boolean(options.long),items:selected.slice(offset,offset+limit),unread_count:all.filter(i=>!i.read_at).length,total:selected.length,through:new Date().toISOString(),has_more:selected.length>offset+limit,next_cursor:selected.length>offset+limit?String(offset+limit):null}});
 });
 await page.goto('http://127.0.0.1:4356'+(options.history?'/notifications':'/dashboard'));
 return {page,state,errors,reads,setItems:value=>{items=value}};
}
async function check(name,run){await run();results.push({name,passed:true});console.log('PASS '+name)}
try{
 await check('desktop action cluster keeps bell next to new invoice',async()=>{
  const c=await setup();try{
   const create=c.page.getByRole('link',{name:'Nová faktura',exact:true});const bell=c.page.getByTitle('Oznámení',{exact:true});
   const a=await create.boundingBox(),b=await bell.boundingBox();expect(b.x-a.x-a.width).toBeLessThanOrEqual(14);expect(Math.abs(a.y+a.height/2-b.y-b.height/2)).toBeLessThanOrEqual(1);
  }finally{await c.page.close()}
 });
 for(const width of [320,390,768,1536])await check('notification layout and keyboard '+width,async()=>{
  const c=await setup(width);try{
   const bell=c.page.getByTitle('Oznámení',{exact:true});await expect(bell).toHaveAttribute('aria-label',/2 nepřečtených/);await expect(bell.locator('i')).toHaveCount(1);
   if(width===1536)await c.page.screenshot({path:resolve(output,'bell-closed.png'),fullPage:false});
   await bell.focus();await c.page.keyboard.press('Enter');const panel=c.page.getByRole('region',{name:'Panel oznámení'});await expect(panel).toBeVisible();await expect(bell).toHaveAttribute('aria-expanded','true');await expect(panel.getByRole('listitem')).toHaveCount(4);
   const box=await panel.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y+box.height).toBeLessThanOrEqual(width<=390?568:1024);expect(await c.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await c.page.screenshot({path:resolve(output,`panel-${width}.png`),fullPage:false});
   await c.page.keyboard.press('Escape');await expect(panel).not.toBeVisible();await expect(bell).toBeFocused();await bell.click();await c.page.mouse.click(2,700);await expect(panel).not.toBeVisible();expect(c.errors).toEqual([]);
  }finally{await c.page.close()}
 });
 for(const width of [320,390,768,1536])await check('long text wraps inside linked and unlinked notifications '+width,async()=>{
  const c=await setup(width,{long:true});try{
   await c.page.getByTitle('Oznámení',{exact:true}).click();
   const panel=c.page.getByRole('region',{name:'Panel oznámení'});await expect(panel.getByRole('listitem')).toHaveCount(4);
   expect(await panel.locator('li').evaluateAll(rows=>rows.every(row=>[row,...row.querySelectorAll('a,button,span,time')].filter(el=>el.clientWidth>1).every(el=>el.scrollWidth<=el.clientWidth+1)))).toBe(true);
   const box=await panel.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y+box.height).toBeLessThanOrEqual(width<=390?568:1024);
   await c.page.screenshot({path:resolve(output,`long-text-${width}.png`),fullPage:false});
  }finally{await c.page.close()}
 });
 await check('mark one, navigation and independent users',async()=>{
  const c=await setup();try{
   const bell=c.page.getByTitle('Oznámení',{exact:true});await expect(bell).toHaveAttribute('aria-label',/2 nepřečtených/);await bell.click();await c.page.getByRole('link',{name:/Faktura po splatnosti/}).click();
   await expect.poll(()=>c.page.evaluate(()=>window.testNavigation)).toBe('/invoices/'+id(101));await expect(bell).toHaveAttribute('aria-label',/1 nepřečtených/);
   await c.page.goto('http://127.0.0.1:4356/dashboard?user=b');await expect(c.page.getByTitle('Oznámení',{exact:true})).toHaveAttribute('aria-label',/2 nepřečtených/);
   await c.page.goto('http://127.0.0.1:4356/dashboard?user=a');await expect(c.page.getByTitle('Oznámení',{exact:true})).toHaveAttribute('aria-label',/1 nepřečtených/);
  }finally{await c.page.close()}
 });
 await check('mark all updates every feed and hides dot',async()=>{
  const c=await setup();try{const bell=c.page.getByTitle('Oznámení',{exact:true});await expect(bell).toHaveAttribute('aria-label',/2 nepřečtených/);await bell.click();await c.page.getByRole('button',{name:'Vše jako přečtené'}).click();await expect(bell).toHaveAttribute('aria-label','Oznámení');await expect(bell.locator('i')).toHaveCount(0);await expect(c.page.locator('li[data-unread]')).toHaveCount(0);}finally{await c.page.close()}
 });
 await check('read failure preserves unread without blocking payment navigation',async()=>{
  const c=await setup();try{const bell=c.page.getByTitle('Oznámení',{exact:true});await expect(bell).toHaveAttribute('aria-label',/2 nepřečtených/);await bell.click();c.state.failPatch=true;await c.page.getByRole('link',{name:/Nespárovaná platba/}).click();await expect.poll(()=>c.page.evaluate(()=>window.testNavigation)).toContain('/invoices/payments/archive?highlight=');await expect(bell).toHaveAttribute('aria-expanded','false');await expect(bell).toHaveAttribute('aria-label',/2 nepřečtených/);await bell.click();await expect(c.page.getByRole('alert')).toContainText('nepodařilo označit');c.state.failPatch=false;await c.page.getByRole('link',{name:/Nespárovaná platba/}).click();await expect.poll(()=>c.page.evaluate(()=>window.testNavigation)).toContain('/invoices/payments/archive?highlight=');}finally{await c.page.close()}
 });
 await check('empty, loading, fetch error and recovery',async()=>{
  const c=await setup(390,{empty:true});try{const bell=c.page.getByTitle('Oznámení',{exact:true});await bell.click();await expect(c.page.getByText('Zatím žádná oznámení')).toBeVisible();await expect(bell.locator('i')).toHaveCount(0);c.state.failGet=true;await c.page.reload();await c.page.getByTitle('Oznámení',{exact:true}).click();await expect(c.page.getByRole('alert')).toContainText('nepodařilo načíst');c.state.failGet=false;c.state.delay=true;await c.page.getByRole('button',{name:'Zkusit znovu'}).click();await expect(c.page.getByRole('status',{name:'Načítání oznámení'})).toBeVisible();await expect(c.page.getByText('Zatím žádná oznámení')).toBeVisible();expect(c.state.gets).toBeLessThan(8);}finally{await c.page.close()}
 });
 await check('history unread filter and keyset pagination',async()=>{
  const c=await setup(390,{history:true});try{const history=c.page.getByRole('region',{name:'Historie oznámení'});await expect(history.getByRole('listitem')).toHaveCount(30);await history.getByRole('button',{name:'Další',exact:true}).click();await expect(history.getByRole('listitem')).toHaveCount(15);await expect(history).toContainText('strana 2');await history.getByRole('button',{name:'Nepřečtená',exact:true}).click();await expect(history).toContainText('strana 1');await expect(history.locator('li')).toHaveCount(23);await c.page.getByRole('button',{name:'Vše jako přečtené'}).first().click();await expect(history.getByText('Všechna oznámení jsou přečtená')).toBeVisible();await c.page.screenshot({path:resolve(output,'history-390.png'),fullPage:true});expect(c.errors).toEqual([]);}finally{await c.page.close()}
 });
 await writeFile(resolve(output,'validation.json'),JSON.stringify(results,null,2));
}finally{await browser.close();await server.close()}
