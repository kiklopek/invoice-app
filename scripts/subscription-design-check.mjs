import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {subscriptionFixture} from './subscription-design-fixtures.mjs';
const project=process.cwd(),fixture=resolve('.cache/subscription-design'),output=resolve('docs/redesign/visual-validation/subscription');
await mkdir(fixture,{recursive:true});await mkdir(output,{recursive:true});
await writeFile(resolve(fixture,'index.html'),'<html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>');
await writeFile(resolve(fixture,'link.tsx'),"import{createElement}from'react';export default function Link({children,prefetch:_p,...props}){return createElement('a',props,children)}");
await writeFile(resolve(fixture,'image.tsx'),"import{createElement}from'react';export default function Image({priority:_p,preload:_pr,fill:_f,unoptimized:_u,...props}){return createElement('img',props)}");
await writeFile(resolve(fixture,'navigation.tsx'),"export function usePathname(){return location.pathname}export function useRouter(){return{push:url=>location.assign(url),replace:url=>location.replace(url),prefetch:()=>{},refresh:()=>{}}}export function useSearchParams(){return new URLSearchParams(location.search)}");
await writeFile(resolve(fixture,'entry.tsx'),`import React from 'react';import{createRoot}from'react-dom/client';import '${project}/src/app/globals.css';import '${project}/src/app/minimal.css';import '${project}/src/app/styles/responsive.css';import{AppShell}from'${project}/src/components/layout/app-shell';import{WorkspaceDataProvider}from'${project}/src/components/workspace-data-provider';import{ToastProvider}from'${project}/src/components/toast';import{SubscriptionClient}from'${project}/src/app/(workspace)/predplatne/subscription-client';createRoot(document.getElementById('root')).render(<WorkspaceDataProvider><ToastProvider><AppShell initialProfile={{role:'admin',name:'Tomáš R.',email:'fixture@example.invalid',companyName:'Demo firma s.r.o.'}}><SubscriptionClient/></AppShell></ToastProvider></WorkspaceDataProvider>);`);
const require=createRequire(import.meta.url),vr=createRequire(require.resolve('vitest/config'));
const {createServer}=await import(pathToFileURL(vr.resolve('vite')).href);
const server=await createServer({configFile:false,root:fixture,publicDir:resolve('public'),logLevel:'error',server:{host:'127.0.0.1',port:4349,strictPort:true,fs:{allow:[project]}},esbuild:{jsx:'automatic'},css:{postcss:{plugins:[]}},resolve:{alias:[{find:'next/link',replacement:resolve(fixture,'link.tsx')},{find:'next/image',replacement:resolve(fixture,'image.tsx')},{find:'next/navigation',replacement:resolve(fixture,'navigation.tsx')},{find:'@',replacement:resolve('src')}],dedupe:['react','react-dom']}});
await server.listen();const browser=await chromium.launch();const results=[];
async function pageFor(width=1536,height=1024,scenario='active',query=''){
 const page=await browser.newPage({viewport:{width,height}}),data=subscriptionFixture(scenario),requests=[],errors=[];let reads=0;
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://billing.stripe.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Isolated provider fixture</h1>'}));
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const body=request.method()==='POST'?request.postDataJSON():null;requests.push({path,method:request.method(),body});
  if(path==='/api/billing'&&request.method()==='GET'){
   reads++;if(scenario==='loaderror'&&reads===1)return route.fulfill({status:503,json:{error:'Test outage'}});
   return route.fulfill({json:data});
  }
  if(path==='/api/billing/subscription'){
   if(body.action==='preview')return route.fulfill({json:{kind:body.period==='yearly'?'upgrade':'downgrade',dueNowHalere:12345,nextChargeHalere:79000,effectiveAt:'2026-11-23T00:00:00Z',prorationDate:Math.floor(Date.now()/1000)}});
   if(body.action==='preview_end_trial')return route.fulfill({json:{dueNowHalere:99000,currency:'czk'}});
   if(body.action==='change'){data.subscription.plan=body.plan;data.subscription.period=body.period;}
   if(body.action==='cancel')data.subscription.cancel_at_period_end=true;
   if(body.action==='resume')data.subscription.cancel_at_period_end=false;
   if(body.action==='portal')return route.fulfill({json:{url:'https://billing.stripe.com/isolated-fixture'}});
   return route.fulfill({json:{status:'changed'}});
  }
  if(path==='/api/billing/activate')return route.fulfill({json:{status:'subscribed'}});
  if(path==='/api/billing/setup')return route.fulfill({json:{url:'https://billing.stripe.com/isolated-fixture'}});
  return route.fulfill({json:path==='/api/search'?{results:[]}:{}});
 });
 await page.goto(`http://127.0.0.1:4349/predplatne${query}`);
 if(scenario==='loaderror')await expect(page.getByRole('button',{name:'Zkusit znovu',exact:true})).toBeVisible();
 else await expect(page.getByRole('region',{name:'Aktuální předplatné'})).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);
 return{page,data,requests,errors};
}
async function check(name,run){await run();results.push({name,passed:true});console.log('PASS '+name);}
try{
 for(const[width,height]of[[1536,1024],[1440,900],[1280,800],[768,1024],[390,844],[320,568]])await check(`subscription layout ${width}x${height}`,async()=>{
  const c=await pageFor(width,height);try{
   expect(await c.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await expect(c.page.getByRole('heading',{name:'Dostupné plány'})).toBeVisible();
   await expect(c.page.getByRole('button',{name:'Aktuální plán',exact:true})).toBeDisabled();
   await expect(c.page.getByRole('progressbar')).toHaveCount(1);
   await c.page.screenshot({path:resolve(output,`subscription-${width}x${height}.png`),fullPage:true});
   expect(c.errors).toEqual([]);
  }finally{await c.page.close();}
 });
 await check('interval switch is only a preview; cancel confirmation does not mutate',async()=>{
  const c=await pageFor();try{
   await c.page.getByRole('button',{name:/Ročně/}).click();
   await expect(c.page.getByText(/Roční platba/)).toHaveCount(3);
   expect(c.requests.filter(r=>r.method==='POST')).toHaveLength(0);
   await c.page.getByRole('button',{name:'Zvolit plán',exact:true}).first().click();
   const dialog=c.page.getByRole('dialog');await expect(dialog).toContainText('123,45');
   await dialog.getByRole('button',{name:'Zrušit',exact:true}).click();
   expect(c.requests.filter(r=>r.body?.action==='change')).toHaveLength(0);
   await c.page.getByRole('button',{name:'Zvolit plán',exact:true}).first().click();
   await dialog.getByRole('button',{name:/Zaplatit/}).click();
   await expect(c.page.getByRole('status')).toContainText('Tarif je změněný');
   expect(c.requests.filter(r=>r.body?.action==='change')).toHaveLength(1);
  }finally{await c.page.close();}
 });
 await check('scheduled cancellation and resumption, actual portal navigation',async()=>{
  const c=await pageFor();try{
   await c.page.getByLabel('Možnosti předplatného').click();await c.page.getByRole('button',{name:'Zrušit předplatné',exact:true}).click();
   const dialog=c.page.getByRole('dialog');await expect(dialog).toContainText('23. 11. 2026');
   await dialog.getByRole('button',{name:'Zrušit předplatné',exact:true}).click();
   await expect(c.page.getByText('Naplánované ukončení',{exact:true})).toBeVisible();
   await c.page.getByRole('button',{name:'Obnovit automatické obnovení'}).click();
   await expect(c.page.getByText('Aktivní',{exact:true})).toBeVisible();
   expect(c.requests.filter(r=>r.body?.action==='cancel')).toHaveLength(1);expect(c.requests.filter(r=>r.body?.action==='resume')).toHaveLength(1);
   await c.page.getByRole('button',{name:'Změnit platební metodu',exact:true}).click();
   await c.page.waitForURL('https://billing.stripe.com/isolated-fixture');
  }finally{await c.page.close();}
 });
 await check('load failure and retry',async()=>{
  const c=await pageFor(390,844,'loaderror');try{
   await c.page.getByRole('button',{name:'Zkusit znovu',exact:true}).click();
   await expect(c.page.getByRole('region',{name:'Aktuální předplatné'})).toBeVisible();expect(c.errors).toEqual([]);
  }finally{await c.page.close();}
 });
 for(const scenario of['trial','yearly','custom','canceled','scheduled','past_due','exempt','missing','expired','readonly','provider_error','expired_card','limit'])await check(`subscription state ${scenario}`,async()=>{
  const c=await pageFor(1280,900,scenario);try{
   await c.page.screenshot({path:resolve(output,`${scenario}.png`),fullPage:true});
   if(scenario==='past_due'){await expect(c.page.getByRole('alert')).toHaveCount(1);await expect(c.page.getByRole('button',{name:'Opravit platební údaje'})).toBeVisible();}
   if(scenario==='readonly'){await expect(c.page.getByRole('button',{name:'Změnit plán'})).toBeDisabled();await expect(c.page.getByText('Platební údaje jsou dostupné administrátorovi firmy.')).toBeVisible();}
   if(scenario==='exempt')await expect(c.page.getByRole('heading',{name:'Trvalý přístup'})).toBeVisible();
   if(scenario==='custom')await expect(c.page.getByRole('region',{name:'Aktuální předplatné'})).toContainText('990');
   if(scenario==='limit')await expect(c.page.getByText('Limit je dosažený.')).toBeVisible();
   expect(c.errors).toEqual([]);
  }finally{await c.page.close();}
 });
 await check('provider return verifies the setup session only once',async()=>{
  const c=await pageFor(1280,900,'active','?platba=hotovo&session=cs_isolated_fixture');try{
   await expect(c.page.getByRole('status')).toContainText('Karta je uložená');
   expect(c.requests.filter(r=>r.path==='/api/billing/activate')).toHaveLength(1);
  }finally{await c.page.close();}
 });
}finally{await browser.close();await server.close();await writeFile(resolve(output,'validation.json'),JSON.stringify({scope:'Real shared AppShell and SubscriptionClient; synthetic API/Stripe data only, no real financial operations',results},null,2));}
