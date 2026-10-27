// Real components and CSS, synthetic scoped HTTP fixtures; no production writes or email.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { chromium, webkit, expect } from '@playwright/test';
const root=process.cwd(),dir=resolve('.cache/invoice-creation-check'),out=resolve('docs/redesign/visual-validation/invoice-creation');
await mkdir(dir,{recursive:true});await mkdir(out,{recursive:true});
await writeFile(resolve(dir,'index.html'),'<html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>');
await writeFile(resolve(dir,'link.tsx'),"import React from'react';export default function Link({children,prefetch:_p,scroll:_s,...props}){return React.createElement('a',props,children)}");
await writeFile(resolve(dir,'image.tsx'),"import React from'react';export default function Image({fill:_f,priority:_p,preload:_pr,unoptimized:_u,...props}){return React.createElement('img',props)}");
await writeFile(resolve(dir,'navigation.tsx'),"export function usePathname(){return '/invoices/create'}export function useSearchParams(){return new URLSearchParams(location.search)}export function useRouter(){return{push:()=>{},replace:()=>{},prefetch:()=>{},refresh:()=>{}}}");
await writeFile(resolve(dir,'entry.tsx'),`
import React from'react';import{createRoot}from'react-dom/client';import'${root}/src/app/globals.css';import'${root}/src/app/minimal.css';import'${root}/src/app/styles/responsive.css';
import{AppShell,AppFrame}from'${root}/src/components/layout/app-shell';import{WorkspaceDataProvider}from'${root}/src/components/workspace-data-provider';import{ToastProvider}from'${root}/src/components/toast';import{InvoiceCreation}from'${root}/src/components/invoice-creation/invoice-creation';import styles from'${root}/src/components/invoice-creation/invoice-creation.module.css';import{creationDocument,creationInput}from'${root}/src/lib/invoice-creation';
window.makeInvoice=(draft,supplier)=>({id:draft.request_id,organization_id:'fixture-org',status:'pending',paid_amount:0,...creationInput(creationDocument(draft,supplier))});
createRoot(document.getElementById('root')).render(<WorkspaceDataProvider><ToastProvider><AppShell initialProfile={{role:'admin',name:'Anna Nováková',email:'anna@example.invalid',companyName:'Demo firma s.r.o.',vatPayer:true}}><AppFrame invoiceCount={35} className={'content section-page '+styles.page}><InvoiceCreation/></AppFrame></AppShell></ToastProvider></WorkspaceDataProvider>);
`);
const supplier={name:'Demo firma s.r.o.',ico:'12345678',dic:'CZ12345678',address:'Praha 1, Dlouhá 10, 110 00',email:'firma@example.invalid',vat_payer:true,bank_account_czk:'6844160247/0100',bank_account_eur:'',bank_accounts:[]};
const customer={id:'550e8400-e29b-41d4-a716-446655440001',name:'WOOD & PAPER a.s.',ico:'87654321',dic:'CZ87654321',address:'Brno, Dolní 2',email:'faktury@example.invalid'};
const context={supplier,customers:[customer],today:'2026-10-25',suggested_number:'FV-2026-000027',draft_scope:'fixture-org:fixture-user',can_send:true};
const require=createRequire(import.meta.url),vr=createRequire(require.resolve('vitest/config'));const{createServer}=await import(pathToFileURL(vr.resolve('vite')).href);
const server=await createServer({configFile:false,root:dir,publicDir:resolve('public'),logLevel:'error',server:{host:'127.0.0.1',port:4399,strictPort:true,fs:{allow:[root]}},esbuild:{jsx:'automatic'},css:{postcss:{plugins:[]}},resolve:{alias:[{find:/^next\/link$/,replacement:resolve(dir,'link.tsx')},{find:/^next\/image$/,replacement:resolve(dir,'image.tsx')},{find:/^next\/navigation$/,replacement:resolve(dir,'navigation.tsx')},{find:'@',replacement:resolve('src')}],dedupe:['react','react-dom']}});
await server.listen();const engine=process.argv.includes('--webkit')?'webkit':'chromium',browser=await({chromium,webkit}[engine]).launch(),results=[];
async function setup(width=1440,height=1000,overrides={}){
 const page=await browser.newPage({viewport:{width,height},locale:'cs-CZ'}),requests=[],errors=[];let failSend=false,failIssue=false,stored=null;
 const ctx={...context,...overrides};page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async r=>{const req=r.request(),url=new URL(req.url());requests.push({method:req.method(),path:url.pathname,body:req.postDataJSON()});
  if(url.pathname==='/api/invoices/creation')return r.fulfill({json:url.searchParams.has('customer_id')?{customer}:ctx});
  if(url.pathname==='/api/customers/search')return r.fulfill({json:{customers:ctx.customers.filter(c=>c.name.toLowerCase().includes((url.searchParams.get('q')??'').toLowerCase()))}});
  if(url.pathname==='/api/customers'&&req.method()==='POST')return r.fulfill({json:{customer:{id:'550e8400-e29b-41d4-a716-446655440002',...req.postDataJSON()}}});
  if(url.pathname==='/api/invoices'&&req.method()==='POST'){if(failIssue){failIssue=false;return r.fulfill({status:503,json:{error:'Testovací chyba vystavení'}})}stored??=await page.evaluate(({draft,supplier})=>window.makeInvoice(draft,supplier),{draft:req.postDataJSON().creation,supplier:ctx.supplier});return r.fulfill({json:{invoice:stored}})}
  if(url.pathname.endsWith('/send')){if(failSend){failSend=false;return r.fulfill({status:502,json:{error:'Testovací chyba odeslání'}})}return r.fulfill({json:{ok:true}})}
  if(url.pathname.endsWith('/pdf')||url.pathname.endsWith('/preview'))return r.fulfill({headers:{'content-type':'application/pdf'},body:Buffer.from('%PDF-1.4\nfixture\n%%EOF')});
  return r.fulfill({json:{items:[],total:0,unread_count:0,through:new Date().toISOString()}});
 });
 await page.goto('http://127.0.0.1:4399/invoices/create');await page.getByRole('heading',{name:'Základní údaje',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
 return{page,requests,errors,failSend:()=>{failSend=true},failIssue:()=>{failIssue=true}};
}
async function fill(page){await page.getByRole('combobox',{name:'Odběratel',exact:true}).click();await page.getByRole('option',{name:/WOOD & PAPER/}).click();await page.getByRole('textbox',{name:'Název položky 1',exact:true}).fill('Consultingové služby');await page.getByRole('textbox',{name:'Cena za jednotku 1',exact:true}).fill('50000');}
try{
 if(!process.argv.includes("--menu-only")){
 {
  const c=await setup(1440,800,{supplier:{...supplier,name:'Dlouhý název společnosti se službami a poradenstvím '.repeat(4)}}),p=c.page;await fill(p);await p.getByRole('textbox',{name:'Cena za jednotku 1',exact:true}).fill('99999999.1234');await p.getByRole('textbox',{name:'Množství 1',exact:true}).fill('1000.125');
  expect(await p.locator('[data-invoice-document]').evaluate(n=>n.scrollWidth<=n.clientWidth+1)).toBe(true);expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await p.screenshot({path:resolve(out,`${engine}-long-company.png`),fullPage:true});expect(c.errors).toEqual([]);await p.close();results.push({scenario:'long company name and precise large values remain inside document',passed:true});console.log('PASS long company name and exact large amounts');
 }
 {
  const c=await setup(1440,1000,{supplier:{...supplier,logo_path:'/brand/drevohlavica.png'}}),p=c.page,doc=p.locator('[data-invoice-document]');
  await expect(doc.getByRole('heading',{name:supplier.name,exact:true})).toBeVisible();await expect(doc.getByText('Koncept',{exact:true})).toHaveCount(0);await expect(doc.getByAltText(`Logo firmy ${supplier.name}`)).toBeVisible();expect(await doc.getByAltText(`Logo firmy ${supplier.name}`).evaluate(n=>n.naturalWidth)).toBeGreaterThan(0);
  await p.screenshot({path:resolve(out,`${engine}-company-logo.png`)});await p.close();results.push({scenario:'company name and configured logo in document heading',passed:true});console.log('PASS company heading and logo');
 }
 {
  const c=await setup(1440,1000,{supplier:{...supplier,logo_path:'/brand/missing-test-logo.png'}}),p=c.page;await expect(p.locator('[data-invoice-document]').getByAltText('Splatno',{exact:true})).toBeVisible();await p.close();results.push({scenario:'unavailable company logo falls back to Splatno',passed:true});console.log('PASS unavailable logo fallback');
 }
 for(const width of [1440,390]){
  const c=await setup(width,1000,{customers:Array.from({length:50},(_,i)=>({...customer,id:`550e8400-e29b-41d4-a716-${String(i).padStart(12,'0')}`,name:`Zákazník ${i+1}`}))}),p=c.page;
  const input=p.getByRole('combobox',{name:'Odběratel',exact:true});await input.click();const menu=p.getByRole('listbox',{name:'Zákazníci',exact:true});
  await expect(menu.getByRole('option')).toHaveCount(50);await expect(menu).toHaveAttribute('data-fitted','');
  const anchor=await input.evaluate(n=>{const r=n.parentElement.getBoundingClientRect();return{x:r.x,y:r.y,bottom:r.bottom,width:r.width}}),box=await menu.boundingBox();
  expect(Math.abs(box.y-anchor.bottom-6)).toBeLessThanOrEqual(1);expect(Math.abs(box.x-anchor.x)).toBeLessThanOrEqual(1);expect(Math.abs(box.width-anchor.width)).toBeLessThanOrEqual(1);expect(box.height).toBeLessThanOrEqual(260);expect(box.y+box.height).toBeLessThanOrEqual(989);
  await p.screenshot({path:resolve(out,`${engine}-${width}-customers.png`)});await menu.evaluate(n=>{n.scrollTop=n.scrollHeight});await expect(menu.getByRole('option',{name:/Zákazník 50/})).toBeInViewport();expect(c.errors).toEqual([]);await p.close();results.push({scenario:`50 customers anchored below input at ${width}`,passed:true});console.log('PASS customer dropdown anchor '+width);
 }
 for(const width of [1920,1440,1280,1024,1023,768,767,390,320]){
  const c=await setup(width);await fill(c.page);await expect(c.page.locator('[data-invoice-document]')).toContainText('60 500,00 Kč');await expect(c.page.getByAltText('QR platba')).toBeVisible();
  expect(await c.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const outside=await c.page.locator('form').filter({has:c.page.getByRole('textbox',{name:'Název položky 1',exact:true})}).evaluate(form=>{const r=form.getBoundingClientRect();return [...form.querySelectorAll('input,select,textarea')].filter(n=>n.getClientRects().length&&getComputedStyle(n).opacity!=='0'&&getComputedStyle(n).clipPath==='none').filter(n=>{const b=n.getBoundingClientRect();return b.x<r.x-1||b.right>r.right+1||b.height<44}).map(n=>({html:n.outerHTML.slice(0,400),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,x:n.getBoundingClientRect().x,formX:r.x,formWidth:r.width}))});
  expect(outside).toEqual([]);
  await expect(c.page.getByRole('link',{name:'Vystavit fakturu',exact:true})).toHaveCount(width>=1024?1:0);
  if(width>=1280){const a=await c.page.locator('form').first().boundingBox(),b=await c.page.locator('[data-invoice-document]').boundingBox();expect(b.x).toBeGreaterThan(a.x+a.width);}
  await c.page.screenshot({path:resolve(out,`${engine}-${width}.png`),fullPage:true});
  if(width>=1280){
   await c.page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,700)});
   await expect.poll(async()=>Math.round((await c.page.locator('aside').filter({has:c.page.getByRole('heading',{name:'Náhled faktury',exact:true})}).boundingBox()).y)).toBe(20);
   const rect=await c.page.locator('aside').filter({has:c.page.getByRole('heading',{name:'Náhled faktury',exact:true})}).boundingBox();expect(rect.y+rect.height).toBeLessThanOrEqual(981);
   await expect(c.page.getByRole('button',{name:'Vystavit a odeslat fakturu',exact:true})).toBeInViewport();
   await c.page.screenshot({path:resolve(out,`${engine}-${width}-scrolled.png`)});
  }
  expect(c.errors).toEqual([]);results.push({width,passed:true});await c.page.close();console.log('PASS invoice creation layout '+width);
 }
 {
  const c=await setup(),p=c.page;await fill(p);
  await p.getByRole('button',{name:'Přidat položku',exact:true}).click();await p.getByRole('textbox',{name:'Název položky 2',exact:true}).fill('Druhá služba');await p.getByRole('textbox',{name:'Cena za jednotku 2',exact:true}).fill('1000');await p.getByRole('combobox',{name:'Sazba DPH 2',exact:true}).selectOption('12');await expect(p.locator('[data-invoice-document]')).toContainText('61 620,00 Kč');
  await p.getByRole('textbox',{name:'Interní poznámka',exact:true}).fill('PRIVATE-INTERNAL-NOTE');await p.getByRole('textbox',{name:'Poznámka na faktuře',exact:true}).fill('PUBLIC-NOTE');await expect(p.locator('[data-invoice-document]')).not.toContainText('PRIVATE-INTERNAL');await expect(p.locator('[data-invoice-document]')).toContainText('PUBLIC-NOTE');
  await p.getByRole('button',{name:'Uložit koncept',exact:true}).click();await expect(p.getByRole('status').filter({hasText:'Koncept je uložen'})).toBeVisible();expect(c.requests.filter(r=>r.method==='POST'&&r.path==='/api/invoices')).toHaveLength(0);
  await p.reload();await expect(p.getByRole('textbox',{name:'Název položky 2',exact:true})).toHaveValue('Druhá služba');
  c.failSend();await p.getByRole('button',{name:'Vystavit a odeslat fakturu',exact:true}).click();await p.getByRole('button',{name:'Potvrdit odeslání',exact:true}).click();await expect(p.getByRole('alert').filter({hasText:'Testovací chyba odeslání'})).toBeVisible();
  expect(c.requests.filter(r=>r.method==='POST'&&r.path==='/api/invoices')).toHaveLength(1);
  await p.getByRole('button',{name:'Odeslat vystavenou fakturu',exact:true}).click();await p.getByRole('button',{name:'Potvrdit odeslání',exact:true}).click();await expect(p.getByRole('button',{name:'Faktura odeslána',exact:true})).toBeDisabled();expect(c.requests.filter(r=>r.method==='POST'&&r.path==='/api/invoices')).toHaveLength(1);expect(c.requests.filter(r=>r.path.endsWith('/send'))).toHaveLength(2);
  const download=p.waitForEvent('download');await p.getByRole('button',{name:'Stáhnout PDF',exact:true}).click();expect((await download).suggestedFilename()).toContain('Faktura');
  expect(c.errors).toEqual([]);await p.screenshot({path:resolve(out,`${engine}-issued.png`),fullPage:true});await p.close();results.push({scenario:'mixed VAT, local draft, private notes, issue/send retry, PDF',passed:true});console.log('PASS lifecycle and retry without duplicate issuance');
 }
 {
  const c=await setup(),p=c.page;await p.getByRole('button',{name:'Přidat zákazníka',exact:true}).click();const d=p.getByRole('dialog',{name:'Přidat zákazníka',exact:true});
  await d.getByRole('textbox',{name:'Název / jméno *',exact:true}).fill('Nový zákazník');await d.getByRole('textbox',{name:'Fakturační adresa *',exact:true}).fill('Ostrava, Hlavní 3');await d.getByRole('button',{name:'Přidat a vybrat zákazníka',exact:true}).click();await expect(d).toHaveCount(0);await expect(p.getByRole('combobox',{name:'Odběratel',exact:true})).toHaveValue('Nový zákazník');expect(c.requests.filter(r=>r.path==='/api/customers'&&r.method==='POST')).toHaveLength(1);
  await p.getByRole('textbox',{name:'Název položky 1',exact:true}).fill('Služba');await p.getByRole('textbox',{name:'Cena za jednotku 1',exact:true}).fill('100');await p.getByLabel('Další možnosti vystavení').click();await p.getByRole('button',{name:'Vystavit bez odeslání',exact:true}).click();await expect(p.getByRole('status').filter({hasText:'byla vystavena'})).toBeVisible();expect(c.requests.filter(r=>r.path.endsWith('/send'))).toHaveLength(0);expect(c.errors).toEqual([]);await p.close();results.push({scenario:'customer creation and issuance without email',passed:true});console.log('PASS add/select customer and issue without email');
 }
 {
  const c=await setup(1440,1000,{supplier:{...supplier,vat_payer:false,dic:''},can_send:false}),p=c.page;await fill(p);
  await expect(p.getByRole('combobox',{name:'Sazba DPH 1',exact:true})).toHaveCount(0);await expect(p.getByLabel('DUZP *',{exact:true})).toHaveCount(0);
  await expect(p.locator('[data-invoice-document]')).toContainText('50 000,00 Kč');
  await p.getByLabel('Akce položky 1',{exact:true}).click();await p.getByRole('textbox',{name:'Sleva 1',exact:true}).fill('10');await p.getByRole('button',{name:'Duplikovat položku',exact:true}).click();
  await expect(p.getByRole('textbox',{name:'Název položky 2',exact:true})).toHaveValue('Consultingové služby');await expect(p.locator('[data-invoice-document]')).toContainText('90 000,00 Kč');
  await p.getByLabel('Akce položky 2',{exact:true}).click();await p.getByRole('button',{name:'Odstranit položku',exact:true}).last().click();await expect(p.getByRole('textbox',{name:'Název položky 2',exact:true})).toHaveCount(0);
  await p.getByRole('combobox',{name:'Způsob úhrady',exact:true}).selectOption('cash');await expect(p.getByAltText('QR platba')).toHaveCount(0);
  c.failIssue();await p.getByRole('button',{name:'Vystavit fakturu',exact:true}).click();await expect(p.getByRole('alert').filter({hasText:'Testovací chyba vystavení'})).toBeVisible();await expect(p.getByRole('textbox',{name:'Cena za jednotku 1',exact:true})).toHaveValue('50000');
  await p.getByRole('button',{name:'Vystavit fakturu',exact:true}).click();await expect(p.getByRole('button',{name:'Faktura vystavena',exact:true})).toBeDisabled();const posts=c.requests.filter(r=>r.path==='/api/invoices'&&r.method==='POST');expect(posts).toHaveLength(2);expect(posts[0].body.creation.request_id).toBe(posts[1].body.creation.request_id);
  await p.screenshot({path:resolve(out,`${engine}-nonpayer.png`),fullPage:true});expect(c.errors).toEqual([]);await p.close();results.push({scenario:'nonpayer, discount, duplicate/remove, cash without QR, issuance retry',passed:true});console.log('PASS nonpayer, item actions and failed issuance recovery');
 }
 }
 const menuOut=resolve('docs/redesign/visual-validation/responsive-menu');await mkdir(menuOut,{recursive:true});
 let previousIcon=0;
 for(const {width,height=568,text=100,long=false} of [
  ...[320,390,767,768,1023].map(width=>({width})),
  {width:390,height:320},{width:768,height:390},
  ...[320,390,768,1023].map(width=>({width,text:200,long:true})),
 ]){
  const c=await setup(width,height),p=c.page;
  const topbar=p.locator('.mobile-navigation-bar');
  const topbarBefore=await topbar.boundingBox();
  if(text===200)await p.evaluate(()=>document.documentElement.style.fontSize='200%');
  await p.locator('.mobile-navigation-toggle').click();
  const panel=p.getByRole('dialog',{name:'Navigace aplikace',exact:true});
  const nav=p.getByRole('navigation',{name:'Mobilní navigace',exact:true});
  await expect(nav).toBeVisible();
  if(long)await nav.evaluate(n=>{
   n.querySelector('a[href="/customers"] > span:nth-child(2)').textContent='Zákazníci a velmi dlouhý název sekce bez mezer '+ 'DlouhýNázev'.repeat(8);
   n.querySelector('.mobile-navigation-subitems a').textContent='Importovat fakturu s velmi dlouhým doplňujícím názvem';
  });
  const metrics=await nav.evaluate(n=>{
   const main=n.querySelector(':scope > a'),sub=n.querySelector('.mobile-navigation-subitems a');
   return {main:parseFloat(getComputedStyle(main).fontSize),sub:parseFloat(getComputedStyle(sub).fontSize),
    icons:[...n.querySelectorAll('.nav-symbol svg')].map(icon=>icon.getBoundingClientRect().width),
    shortRows:[...n.querySelectorAll('a')].filter(a=>a.getBoundingClientRect().height<(a.closest('.mobile-navigation-subitems')?48:56)-0.1).map(a=>a.textContent),
    clipped:[...n.querySelectorAll('a')].filter(a=>a.scrollWidth>a.clientWidth+1).map(a=>a.textContent)};
  });
  expect(metrics.main).toBeGreaterThanOrEqual(text===200?35.99:17.99);expect(metrics.main).toBeLessThanOrEqual(text===200?40.01:20.01);
  expect(metrics.sub).toBeGreaterThanOrEqual(text===200?31.99:15.99);expect(metrics.sub).toBeLessThanOrEqual(text===200?36.01:18.01);
  expect(metrics.icons).toHaveLength(7);for(const size of metrics.icons){expect(size).toBeGreaterThanOrEqual(19.99);expect(size).toBeLessThanOrEqual(22.01);}
  if(text===100&&height===568){expect(metrics.icons[0]).toBeGreaterThanOrEqual(previousIcon);previousIcon=metrics.icons[0];}
  if(text===100){const progress=Math.max(0,Math.min(1,(width-320)/448));expect(Math.abs(metrics.main-(18+2*progress))).toBeLessThan(0.02);expect(Math.abs(metrics.icons[0]-(20+2*progress))).toBeLessThan(0.02);}
  expect(metrics.shortRows).toEqual([]);expect(metrics.clipped).toEqual([]);
  await expect(nav.locator('a[href="/invoices/create"]')).toHaveClass(/active/);await expect(nav.locator('a[href="/invoices"]')).not.toHaveClass(/active/);
  const badge=nav.locator('a[href="/invoices"] em');await expect(badge).toHaveText('35');
  expect(await badge.evaluate(n=>n.scrollHeight<=n.clientHeight+1)).toBe(true);
  expect(await panel.evaluate(n=>n.scrollWidth<=n.clientWidth+1)).toBe(true);
  const esko=p.getByRole('button',{name:'Esko',exact:true});
  await esko.scrollIntoViewIfNeeded();await expect(esko).toBeInViewport();
  expect(await esko.evaluate(n=>parseFloat(getComputedStyle(n).fontSize))).toBeCloseTo(metrics.main,1);
  const mascot=await esko.locator('img').boundingBox();expect(mascot.width).toBeGreaterThanOrEqual(47.99);expect(mascot.width).toBeLessThanOrEqual(56.01);
  expect(await esko.locator('img').evaluate(n=>Math.abs(n.getBoundingClientRect().height/n.getBoundingClientRect().width-n.naturalHeight/n.naturalWidth))).toBeLessThan(0.02);
  if(text===100)expect(await topbar.boundingBox()).toEqual(topbarBefore);
  await p.screenshot({path:resolve(menuOut,`${engine}-${width}x${height}-text-${text}.png`)});
  await esko.click();await expect(p.getByRole('dialog',{name:'Esko',exact:true})).toBeVisible();
  await p.getByRole('button',{name:'Zavřít chat Esko',exact:true}).click();
  await expect(p.locator('.mobile-navigation-toggle')).toBeFocused();
  expect(c.errors).toEqual([]);await p.close();results.push({scenario:'responsive hamburger menu',width,height,text,metrics,passed:true});console.log(`PASS responsive menu ${width}x${height}, text ${text}%`);
 }
 {
  const c=await setup(1024),p=c.page;
  await expect(p.locator('.mobile-navigation-toggle')).toBeHidden();await expect(p.locator('.desktop-navigation')).toBeVisible();
  expect(await p.locator('.desktop-navigation').evaluate(n=>getComputedStyle(n).getPropertyValue('--menu-text'))).toBe('');
  await p.close();console.log('PASS desktop navigation at 1024 remains separate');
 }
 await writeFile(resolve(menuOut,`${engine}-results.json`),JSON.stringify(results,null,2));
 await writeFile(resolve(out,`${engine}-results.json`),JSON.stringify(results,null,2));
}finally{await browser.close();await server.close();}
