import {PDFDocument} from 'pdf-lib';
import {getDocumentProxy,extractText} from 'unpdf';
// Real components and CSS, synthetic scoped HTTP fixtures; no production writes or email.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
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
createRoot(document.getElementById('root')).render(<WorkspaceDataProvider><ToastProvider><AppShell initialProfile={{role:'admin',name:'Anna Nováková',email:'anna@example.invalid',companyName:'Demo firma s.r.o.',vatPayer:true}}><AppFrame className={'content section-page '+styles.page}><InvoiceCreation/></AppFrame></AppShell></ToastProvider></WorkspaceDataProvider>);
`);
await writeFile(resolve(dir,'dynamic.tsx'),"import React,{lazy,Suspense}from'react';export default function dynamic(loader,opts){const C=lazy(()=>loader().then(m=>({default:m.default||m})));return props=><Suspense fallback={opts?.loading?React.createElement(opts.loading):null}><C {...props}/></Suspense>}");
const supplier={name:'Demo firma s.r.o.',ico:'12345678',dic:'CZ12345678',address:'Praha 1, Dlouhá 10, 110 00',email:'firma@example.invalid',vat_payer:true,bank_account_czk:'6844160247/0100',bank_account_eur:'',bank_accounts:[]};
const customer={id:'550e8400-e29b-41d4-a716-446655440001',name:'WOOD & PAPER a.s.',ico:'87654321',dic:'CZ87654321',address:'Brno, Dolní 2',email:'faktury@example.invalid'};
const context={supplier,customers:[customer],today:'2026-10-25',suggested_number:'FV-2026-000027',draft_scope:'fixture-org:fixture-user',can_send:true};
const require=createRequire(import.meta.url),vr=createRequire(require.resolve('vitest/config'));const{createServer}=await import(pathToFileURL(vr.resolve('vite')).href);
const server=await createServer({configFile:false,optimizeDeps:{include:['pdfjs-dist/build/pdf.mjs'],force:true},root:dir,publicDir:resolve('public'),logLevel:'error',server:{host:'127.0.0.1',port:4399,strictPort:true,fs:{allow:[root]}},esbuild:{jsx:'automatic'},css:{postcss:{plugins:[]}},resolve:{alias:[{find:/^next\/link$/,replacement:resolve(dir,'link.tsx')},{find:/^next\/image$/,replacement:resolve(dir,'image.tsx')},{find:/^next\/navigation$/,replacement:resolve(dir,'navigation.tsx')},{find:/^next\/dynamic$/,replacement:resolve(dir,'dynamic.tsx')},{find:'@',replacement:resolve('src')}],dedupe:['react','react-dom']}});
await server.listen();const engine=process.argv.includes('--webkit')?'webkit':'chromium',browser=await({chromium,webkit}[engine]).launch(),results=[];
async function setup(width=1440,height=1000,overrides={}){
 const page=await browser.newPage({viewport:{width,height},locale:'cs-CZ'}),requests=[],errors=[];let failSend=false,failIssue=false,stored=null;
 const ctx={...context,...overrides};page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message)});page.on('console',m=>{if(m.type()==='error')console.log('BROWSER ERROR',m.text())});
 await page.route('**/api/**',async r=>{const req=r.request(),url=new URL(req.url());requests.push({method:req.method(),path:url.pathname,body:req.postDataJSON()});
  if(url.pathname==='/api/invoices/creation')return r.fulfill({json:url.searchParams.has('customer_id')?{customer}:ctx});
  if(url.pathname==='/api/customers/search')return r.fulfill({json:{customers:ctx.customers.filter(c=>c.name.toLowerCase().includes((url.searchParams.get('q')??'').toLowerCase()))}});
  if(url.pathname==='/api/customers'&&req.method()==='POST')return r.fulfill({json:{customer:{id:'550e8400-e29b-41d4-a716-446655440002',...req.postDataJSON()}}});
  if(url.pathname==='/api/invoices'&&req.method()==='POST'){if(failIssue){failIssue=false;return r.fulfill({status:503,json:{error:'Testovací chyba vystavení'}})}stored??=await page.evaluate(({draft,supplier})=>window.makeInvoice(draft,supplier),{draft:req.postDataJSON().creation,supplier:ctx.supplier});return r.fulfill({json:{invoice:stored}})}
  if(url.pathname.endsWith('/send')){if(failSend){failSend=false;return r.fulfill({status:502,json:{error:'Testovací chyba odeslání'}})}return r.fulfill({json:{ok:true}})}
  if(url.pathname.endsWith('/pdf')||url.pathname.endsWith('/preview'))return r.fulfill({headers:{'content-type':'application/pdf'},body:await readFile(resolve('docs/redesign/visual-validation/invoice-pagination/invoice-30.pdf'))});
  return r.fulfill({json:{items:[],total:0,unread_count:0,through:new Date().toISOString()}});
 });
 await page.goto('http://127.0.0.1:4399/invoices/create');await page.getByRole('heading',{name:'Základní údaje',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
 return{page,requests,errors,failSend:()=>{failSend=true},failIssue:()=>{failIssue=true}};
}
async function fill(page){await page.getByRole('combobox',{name:'Odběratel',exact:true}).click();await page.getByRole('option',{name:/WOOD & PAPER/}).click();await page.getByRole('textbox',{name:'Název položky 1',exact:true}).fill('Consultingové služby');await page.getByRole('textbox',{name:'Cena za jednotku 1',exact:true}).fill('50000');}
try {
 for(const width of [390,1440]){
  const c=await setup(width,844),p=c.page;await fill(p);
  await p.getByRole('button',{name:'Zobrazit PDF',exact:true}).click();
  const modal=p.getByRole('dialog',{name:'Koncept faktury · PDF',exact:true});await expect(modal).toBeVisible();
  await expect(modal.locator('canvas[aria-label="Strana 1"]').first()).toBeVisible({timeout:30000});await expect(modal.getByText('Strana 1 / 5',{exact:true})).toBeVisible();
  const button=modal.getByRole('button',{name:'Vytisknout fakturu',exact:true});await expect(button).toBeEnabled();
  const box=await modal.boundingBox();expect(box.x).toBeGreaterThanOrEqual(7);expect(box.x+box.width).toBeLessThanOrEqual(width-7);expect(box.y).toBeGreaterThanOrEqual(7);expect(box.y+box.height).toBeLessThanOrEqual(844-7);
  await expect(button).toBeInViewport();await expect(modal.getByRole('link',{name:'Otevřít PDF samostatně'})).toHaveAttribute('href',/^blob:/);
  await modal.locator('iframe').evaluate(n=>{n.contentWindow.print=()=>{window.__invoicePrint=(window.__invoicePrint||0)+1}});
  await button.click();expect(await p.evaluate(()=>window.__invoicePrint)).toBe(1);
  await button.focus();await p.keyboard.press('Control+p');expect(await p.evaluate(()=>window.__invoicePrint)).toBe(2);
  await modal.locator('iframe').evaluate(n=>{n.contentWindow.print=()=>{throw new Error('blocked')}});await button.click();await expect(modal.getByRole('status')).toContainText('nepovolil přímý tisk');
  await p.screenshot({path:resolve(out,engine+'-print-'+width+'.png')});
  await modal.getByRole('button',{name:'Zavřít náhled PDF'}).click();await p.keyboard.press('Control+p');await expect(modal).toBeVisible();await modal.getByRole('button',{name:'Zavřít náhled PDF'}).click();
  if(engine==='chromium'){
   await p.emulateMedia({media:'print'});const bytes=await p.pdf({preferCSSPageSize:true,printBackground:false});await writeFile(resolve(out,'browser-print-'+width+'.pdf'),bytes);
   const native=await PDFDocument.load(bytes);for(const page of native.getPages()){expect(page.getWidth()).toBeCloseTo(595.28,0);expect(page.getHeight()).toBeCloseTo(841.89,0);}
   const {text}=await extractText(await getDocumentProxy(new Uint8Array(bytes)),{mergePages:true});expect(text).toContain('WOOD & PAPER');expect(text).toContain('Consultingové služby');expect(text).not.toContain('Základní údaje');expect(text).not.toContain('Uložit koncept');
  }
  expect(c.errors).toEqual([]);results.push({engine,width,passed:true});console.log('PASS invoice PDF print, fallback, shortcut and A4 layout',engine,width);await p.close();
 }
await writeFile(resolve(out,engine+'-print-results.json'),JSON.stringify(results,null,2));
}finally{await browser.close();await server.close();}
