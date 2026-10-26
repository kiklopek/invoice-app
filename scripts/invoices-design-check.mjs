import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {invoicePage,invoiceRows,invoicePagingRows,invoiceTotals,initialQuery} from './invoices-design-fixtures.mjs';
const project=process.cwd(),fixture=resolve(project,'.cache/invoices-design-fixture');
const output=resolve(project,'docs/redesign/visual-validation/invoices');
const before=process.argv.includes('--before');
if(before&&existsSync(resolve(output,'before.png')))throw new Error('Before baseline already exists');
await mkdir(fixture,{recursive:true});await mkdir(output,{recursive:true});
if(!existsSync(resolve(output,'reference.png')))await copyFile('/Users/tadeastrnka/Desktop/Mockupy/faktury.png',resolve(output,'reference.png'));
await writeFile(resolve(fixture,'index.html'),'<html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>');
await writeFile(resolve(fixture,'link.tsx'),`import {createElement} from 'react';export default function Link({href,children,prefetch:_p,...props}){return createElement('a',{...props,href},children)}`);
await writeFile(resolve(fixture,'image.tsx'),`import {createElement} from 'react';export default function Image({src,alt,unoptimized:_u,preload:_pr,priority:_pi,fill:_f,...props}){return createElement('img',{...props,src,alt})}`);
await writeFile(resolve(fixture,'navigation.tsx'),`export function usePathname(){return location.pathname}export function useRouter(){return {push:url=>location.assign(url),replace:url=>location.replace(url),prefetch:()=>{},refresh:()=>{}}}export function useSearchParams(){return new URLSearchParams(location.search)}`);
await writeFile(resolve(fixture,'entry.tsx'),`
import {createElement} from 'react';import{createRoot}from'react-dom/client';
import '${project}/src/app/globals.css';import '${project}/src/app/minimal.css';import '${project}/src/app/styles/responsive.css';import '${project}/src/app/styles/invoice-cards.css';
import{AppShell,AppFrame}from'${project}/src/components/layout/app-shell';import{WorkspaceDataProvider}from'${project}/src/components/workspace-data-provider';import{ToastProvider}from'${project}/src/components/toast';import{InvoicesClient}from'${project}/src/app/(workspace)/invoices/invoices-client';
const scenario=new URLSearchParams(location.search).get('scenario')||'normal';const data=${JSON.stringify({normal:invoicePage(),viewer:invoicePage(undefined,'viewer'),empty:invoicePage(undefined,'empty'),stress:invoicePage(undefined,'stress'),paging:invoicePage(undefined,'paging',invoicePagingRows)})};
const initialSums=${JSON.stringify({normal:invoiceTotals(),viewer:invoiceTotals(undefined,'viewer'),empty:invoiceTotals(undefined,'empty'),stress:invoiceTotals(undefined,'stress'),paging:invoiceTotals(undefined,'paging',invoicePagingRows)})};
const params=new URLSearchParams(location.search);const stored=document.cookie.split('; ').find(item=>item.startsWith('splatno-invoices-page-size='))?.split('=')[1];const size=Number(params.get('page_size')||stored||25);const selectedSize=[10,25,50,100].includes(size)?size:25;
const selectedData={...(data[scenario]||data.normal),page_size:selectedSize};const selectedQuery={...${JSON.stringify(initialQuery)},pageSize:selectedSize};const selectedKey='/api/invoices?paged=1&page=1'+(selectedSize===25?'':'&page_size='+selectedSize);
const profile={role:scenario==='viewer'?'viewer':'admin',name:'Tomáš Adamec',email:'tomas@example.invalid',companyName:'Demo firma s.r.o.'};
createRoot(document.getElementById('root')).render(createElement(WorkspaceDataProvider,null,createElement(ToastProvider,null,createElement(AppShell,{initialProfile:profile},location.pathname==='/invoices'?createElement(InvoicesClient,{initialData:selectedData,initialTotals:initialSums[scenario]||initialSums.normal,initialQuery:selectedQuery,initialKey:selectedKey,initialNow:'2026-10-19T08:00:00Z'}):createElement(AppFrame,null,createElement('h1',null,'Cílová stránka'))))));`);
const require=createRequire(import.meta.url),vr=createRequire(require.resolve('vitest/config'));
const{createServer}=await import(pathToFileURL(vr.resolve('vite')).href);
const server=await createServer({configFile:false,root:fixture,publicDir:resolve(project,'public'),logLevel:'error',server:{host:'127.0.0.1',port:4331,strictPort:true,fs:{allow:[project]}},esbuild:{jsx:'automatic'},css:{postcss:{plugins:[]}},resolve:{alias:[{find:/^next\/link$/,replacement:resolve(fixture,'link.tsx')},{find:/^next\/image$/,replacement:resolve(fixture,'image.tsx')},{find:/^next\/navigation$/,replacement:resolve(fixture,'navigation.tsx')},{find:'@',replacement:resolve(project,'src')}],dedupe:['react','react-dom']}});
await server.listen();const browser=await chromium.launch({headless:true});const results=[];const functional=[];
try{
 for(const[width,height]of before?[[1536,1024]]:[[1536,1024],[1440,900],[1280,800],[768,1024],[390,844]]){
  const page=await browser.newPage({viewport:{width,height},locale:'cs-CZ'});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.hostname!=='127.0.0.1')return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
   if(req.method()!=='GET')return route.fulfill({status:405,json:{error:'Read-only visual fixture'}});
   if(url.pathname==='/api/invoices/totals')return route.fulfill({json:invoiceTotals(url)});
   if(url.pathname==='/api/invoices')return route.fulfill({json:invoicePage(url)});
   if(url.pathname==='/api/search')return route.fulfill({json:{results:[],unavailable:[]}});
   if(url.pathname.endsWith('/assignable-payments'))return route.fulfill({json:{payments:[],remaining_amount:100,currency:'CZK'}});
   return route.fulfill({status:404,json:{error:'Unknown fixture endpoint'}});
  });
  await page.goto('http://127.0.0.1:4331/invoices');await page.locator('h1').waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(250);
  const file=before?'before.png':width===1536?'after-desktop.png':width===768?'after-tablet.png':width===390?'after-mobile.png':`after-${width}x${height}.png`;
  await page.screenshot({path:resolve(output,file),fullPage:false});
  if(!before&&width===390)await page.screenshot({path:resolve(output,'after-mobile-full.png'),fullPage:true});
  const metrics=await page.evaluate(()=>{
   const rect=selector=>{const node=document.querySelector(selector);if(!node)return null;const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
   const styles=Object.fromEntries(['[data-workspace-topbar]','[data-workspace-topbar] form','table th','table td','main'].map(q=>{const n=document.querySelector(q);if(!n)return[q,null];const s=getComputedStyle(n);return[q,Object.fromEntries(['height','minHeight','padding','margin','fontFamily','fontSize','display','boxSizing','lineHeight'].map(k=>[k,s[k]]))]}));return{styles,viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},sidebar:rect('.sidebar'),topbar:rect('[data-workspace-topbar]'),heading:rect('h1'),filters:rect('[data-invoice-filters]'),table:rect('[data-invoice-table]'),footer:rect('[data-invoice-pagination]'),summary:rect('[data-invoice-summary]'),columns:[...document.querySelectorAll('thead th')].map(node=>{const r=node.getBoundingClientRect();return{label:node.textContent.trim(),x:r.x,y:r.y,width:r.width,height:r.height}})};
  });
  if(metrics.document.width>width+1)errors.push('Document has horizontal overflow');
  if(!before){const dates=await page.locator('[role="group"][aria-label^="Datum"]').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().width));if(dates.some(width=>width>221))errors.push('Date range controls are unnecessarily wide');const aligned=await page.locator('[role="group"][aria-label^="Datum"] input').evaluateAll(inputs=>inputs.every(input=>{const icon=input.parentElement.querySelector('svg');if(!icon||getComputedStyle(icon).display==='none')return true;const a=input.getBoundingClientRect(),b=icon.getBoundingClientRect();return Math.abs((a.top+a.height/2)-(b.top+b.height/2))<=1}));if(!aligned)errors.push('Date text and calendar icons are misaligned');}
  results.push({width,height,file,metrics,errors});await page.close();
 }

 if(!before){
  async function pageFor(scenario='normal',viewport={width:1536,height:1024}){
   const page=await browser.newPage({viewport,locale:'cs-CZ'}), requests=[];
   let rows=structuredClone(invoiceRows),failNext=false,delayNext=0,failTotalsNext=false;
   if(scenario==='paging')rows=structuredClone(invoicePagingRows);
   await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.__copied=value}},configurable:true}));
   await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());if(url.hostname!=='127.0.0.1')return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();requests.push({url:url.pathname+url.search,method:req.method(),body:req.postDataJSON?.()});
    if(url.pathname==='/api/invoices/totals'){if(failTotalsNext){failTotalsNext=false;return route.fulfill({status:503,json:{error:'Testovací výpadek součtu'}})}return route.fulfill({json:invoiceTotals(url,scenario,rows)})}
    if(url.pathname==='/api/invoices'){
     if(delayNext){const delay=delayNext;delayNext=0;await new Promise(resolve=>setTimeout(resolve,delay))}
     if(failNext){failNext=false;return route.fulfill({status:503,json:{error:'Testovací výpadek'}})}
     if(url.searchParams.get('format')==='xlsx')return route.fulfill({headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body:Buffer.from('transport fixture')});
     return route.fulfill({json:invoicePage(url,scenario,rows)});
    }
    if(url.pathname==='/api/search')return route.fulfill({json:{results:[],unavailable:[]}});
    if(url.pathname.endsWith('/assignable-payments'))return route.fulfill({json:{payments:[],remaining_amount:266189,currency:'CZK'}});
    if(req.method()==='PATCH'&&url.pathname.startsWith('/api/invoices/')){const id=url.pathname.split('/').pop(),invoice=rows.find(row=>row.id===id);Object.assign(invoice,{status:'paid',paid_amount:invoice.amount});return route.fulfill({json:{invoice}})}
    return route.fulfill({status:404,json:{error:'No fixture endpoint'}});
   });
   await page.goto(`http://127.0.0.1:4331/invoices?scenario=${scenario}`);await page.locator('h1').waitFor();await page.evaluate(()=>document.fonts.ready);
   // Seed paging's initial render through the same public list transport, no API contract change.
   if(scenario==='paging'){await page.getByRole('button',{name:'Další filtry',exact:true}).click();await page.getByRole('searchbox',{name:'Hledat v tabulce'}).fill('1');await expect(page.locator('tbody tr')).toHaveCount(25);await page.getByRole('button',{name:'Vymazat filtry'}).first().click();await expect(page.getByText('Zobrazuji 1–25 z 58 faktur')).toBeVisible();}
   return{page,requests,fail:()=>{failNext=true},slow:()=>{delayNext=450},failTotals:()=>{failTotalsNext=true}};
  }
  async function check(name,run){await run();functional.push({name,passed:true});console.log('PASS '+name)}
  await check('Esko stays available in navigation after reload without a floating overlay',async()=>{
   const{page}=await pageFor();try{
    await page.evaluate(()=>sessionStorage.setItem('splatno:esko:minimized:v1','1'));
    await page.reload();
    const entry=page.getByRole('button',{name:'Esko',exact:true}).filter({visible:true});
    await expect(entry).toBeVisible();await expect(page.locator('[data-esko-launcher],[data-esko-restore]')).toHaveCount(0);
    await entry.click();await expect(page.getByRole('dialog',{name:'Esko'})).toBeVisible();
    await page.keyboard.press('Escape');await expect(entry).toBeFocused();
   }finally{await page.close()}
  });
  for(const width of [768,1023])await check('Tablet cards preserve selection, sort, filters and export '+width,async()=>{
   const{page,requests}=await pageFor('normal',{width,height:1024});try{
    await page.getByRole('checkbox',{name:'Vybrat fakturu 1443260143',exact:true}).check();
    await expect(page.getByText('Vybráno: 1')).toBeVisible();
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export do Excelu',exact:true}).click();await download;
    assert(requests.some(r=>r.url.includes('selected_ids=')));
    await page.getByRole('combobox',{name:'Seřadit podle',exact:true}).selectOption('amount:asc');await expect(page.locator('tbody tr').first()).toContainText('9 116,00');
    await page.getByRole('button',{name:'Další filtry',exact:true}).click();await expect(page.getByRole('combobox',{name:'Měna',exact:true})).toBeVisible();
   }finally{await page.close()}
  });
  await check('Selected Excel download uses only checked IDs on the current page and reports errors',async()=>{
   const{page,requests,fail}=await pageFor('paging');try{
    await page.getByRole('button',{name:'Další stránka',exact:true}).click();
    await expect(page.getByText('Zobrazuji 26–50 z 58 faktur')).toBeVisible();
    const selected=invoicePagingRows.slice(25,27);
    for(const invoice of selected)await page.getByRole('checkbox',{name:`Vybrat fakturu ${invoice.invoice_number}`,exact:true}).check();
    const downloadPromise=page.waitForEvent('download');
    await page.getByRole('button',{name:'Export do Excelu',exact:true}).click();
    const download=await downloadPromise;
    assert.equal(download.suggestedFilename(),'vybrane-faktury.xlsx');
    const exported=requests.filter(request=>request.url.includes('format=xlsx')).at(-1);
    const params=new URL('http://fixture'+exported.url).searchParams;
    assert.equal(params.get('page'),'2');
    assert.deepEqual(params.get('selected_ids').split(','),selected.map(invoice=>invoice.id));
    await expect(page.getByRole('button',{name:'Export do Excelu',exact:true})).toBeEnabled();
    await expect(page.getByText('Vybráno: 2')).toBeVisible();
    await page.screenshot({path:resolve(output,'selected-excel-export.png')});
    fail();await page.getByRole('button',{name:'Export do Excelu',exact:true}).click();
    await expect(page.getByText('Testovací výpadek',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Export do Excelu',exact:true})).toBeEnabled();
   }finally{await page.close()}
  });
  await check('Selection, indeterminate, copy and current-page sorting',async()=>{
   const{page}=await pageFor();try{
    await page.getByRole('checkbox',{name:'Vybrat fakturu 1443260143',exact:true}).check();await expect(page.getByRole('checkbox',{name:'Vybrat všechny faktury na stránce'})).toHaveJSProperty('indeterminate',true);
    await page.getByRole('button',{name:'Zkopírovat čísla',exact:true}).click();assert.equal(await page.evaluate(()=>window.__copied),'1443260143');
    await page.getByRole('checkbox',{name:'Vybrat všechny faktury na stránce'}).check();await expect(page.getByText('Vybráno: 8')).toBeVisible();await page.getByRole('button',{name:'Zrušit výběr'}).click();await expect(page.locator('tbody input:checked')).toHaveCount(0);
    await page.getByRole('button',{name:'Částka',exact:true}).click();await expect(page.getByRole('combobox',{name:'Seřadit podle',exact:true})).toHaveValue('amount:asc');await expect(page.locator('tbody tr').first()).toContainText('9 116,00');await expect(page.getByText('Seřazena aktuální stránka')).toBeVisible();await page.getByRole('button',{name:'Vrátit výchozí řazení'}).click();await expect(page.locator('tbody tr').first()).toContainText('1443260143');
   }finally{await page.close()}
  });
  await check('Sort dropdown replaces currency, controls table headers and preserves advanced currency filter',async()=>{
   const{page}=await pageFor();try{
    const dropdown=page.getByRole('combobox',{name:'Seřadit podle',exact:true});
    await expect(dropdown).toBeVisible();await expect(page.getByRole('combobox',{name:'Měna',exact:true})).not.toBeVisible();
    await dropdown.selectOption('amount:desc');await expect(page.locator('tbody tr').first()).toContainText('1443260143');await expect(page.locator('th[aria-sort="descending"]')).toContainText('Částka');
    await dropdown.selectOption('counterparty_name:asc');await expect(page.locator('tbody tr').first()).toContainText('Daria Pisareva');
    await dropdown.selectOption('due_date:desc');await expect(page.locator('tbody tr').first()).toContainText('Studio K');
    await page.getByRole('button',{name:'Vrátit výchozí řazení'}).click();await expect(dropdown).toHaveValue('default:asc');
    await page.getByRole('button',{name:'Další filtry',exact:true}).click();await expect(page.getByRole('combobox',{name:'Měna',exact:true})).toBeVisible();
   }finally{await page.close()}
  });
  await check('All filters retain parameters, accent-free local search, reset and Excel transport',async()=>{
   const{page,requests}=await pageFor();try{
    await page.getByRole('button',{name:'Další filtry',exact:true}).click();await page.getByRole('searchbox',{name:'Hledat v tabulce'}).fill('stusek');await expect(page.locator('tbody tr')).toHaveCount(1);await expect(page.locator('tbody')).toContainText('Štůšek');
    await page.getByRole('combobox',{name:'Stav úhrady',exact:true}).selectOption('partial');await page.getByRole('combobox',{name:'Měna',exact:true}).selectOption('CZK');await page.getByLabel('Vystaveno od',{exact:true}).fill('2026-09-01');await page.getByLabel('Částka od',{exact:true}).fill('20000');
    await expect.poll(()=>requests.filter(r=>r.url.includes('amount_min=20000')).length).toBeGreaterThan(0);const request=new URL(requests.at(-1).url,'http://fixture');assert.equal(request.searchParams.get('q'),'stusek');assert.equal(request.searchParams.get('payment'),'partial');assert.equal(request.searchParams.get('currency'),'CZK');assert.equal(request.searchParams.get('from'),'2026-09-01');
    await page.getByRole('button',{name:'Další filtry',exact:true}).click();await page.getByRole('button',{name:'Další filtry',exact:true}).click();await expect(page.getByLabel('Částka od',{exact:true})).toHaveValue('20000');
    await page.getByLabel('Další akce faktur',{exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export do Excelu'}).click();assert.match((await download).suggestedFilename(),/faktury.*xlsx/);assert(requests.some(r=>r.url.includes('format=xlsx')&&r.url.includes('q=stusek')));
    await page.getByRole('button',{name:'Vymazat filtry'}).first().click();await expect(page.locator('tbody tr')).toHaveCount(8);
   }finally{await page.close()}
  });
  await check('Row menu keyboard, links and existing payment confirmation guard',async()=>{
   const{page,requests}=await pageFor();try{
    const trigger=page.getByRole('button',{name:'Akce faktury 1443260143',exact:true});await trigger.click();const menu=page.getByRole('dialog',{name:'Akce faktury 1443260143',exact:true});await expect(menu).toBeVisible();await expect(menu.getByRole('link',{name:'Platby a úhrady'})).toHaveAttribute('href',new RegExp('#invoice-payments$'));await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await trigger.click();await menu.getByRole('button',{name:'Potvrdit úhradu',exact:true}).click();
    const modal=page.getByRole('dialog',{name:/Opravdu potvrdit/});await expect(modal).toBeVisible();await expect(modal.getByRole('button',{name:'Potvrdit bez platby'})).toBeDisabled();await modal.getByRole('checkbox',{name:'Potvrdit úhradu bez přiřazení bankovní platby'}).check();await modal.getByRole('button',{name:'Potvrdit bez platby'}).click();await expect(modal).not.toBeVisible();assert(requests.some(r=>r.method==='PATCH'&&r.body.status==='paid'&&r.body.paid_on));
   }finally{await page.close()}
  });
  await check('Filter loading, error retry and no-result state',async()=>{
   const{page,fail,slow}=await pageFor();try{
    fail();slow();await page.getByRole('combobox',{name:'Stav',exact:true}).selectOption('pending');await expect(page.getByRole('status',{name:'Načítám faktury'})).toBeVisible();await expect(page.getByRole('button',{name:'Zkusit znovu'})).toBeVisible();await page.getByRole('button',{name:'Zkusit znovu'}).click();await expect(page.locator('tbody tr')).toHaveCount(4);await page.getByRole('button',{name:'Další filtry',exact:true}).click();await page.getByRole('searchbox',{name:'Hledat v tabulce'}).fill('nenalezeny-vysledek');await expect(page.getByText('Žádné faktury neodpovídají zadaným filtrům.')).toBeVisible();await page.getByRole('button',{name:'Vymazat filtry'}).first().click();await expect(page.locator('tbody tr')).toHaveCount(8);
   }finally{await page.close()}
  });
  await check('Default pagination uses 25 rows per page',async()=>{
   const{page,requests}=await pageFor('paging');try{
    await page.getByRole('button',{name:'Další stránka',exact:true}).click();await expect(page.getByText('Zobrazuji 26–50 z 58 faktur')).toBeVisible();await page.getByRole('button',{name:'Stránka 3',exact:true}).click();await expect(page.getByText('Zobrazuji 51–58 z 58 faktur')).toBeVisible();await expect(page.getByRole('button',{name:'Další stránka',exact:true})).toBeDisabled();assert(requests.some(r=>r.url.includes('page=3')));assert(!requests.some(r=>/sort=/.test(r.url)));
   }finally{await page.close()}
  });
  await check('Page size changes reset pagination and survive refresh and reopening',async()=>{
   const{page,requests}=await pageFor('paging');try{
    const control=page.getByRole('combobox',{name:'Faktur na stránku',exact:true});
    await control.selectOption('10');await expect(page.getByText('Zobrazuji 1–10 z 58 faktur')).toBeVisible();await expect(page.locator('tbody tr')).toHaveCount(10);
    await page.getByRole('button',{name:'Další stránka',exact:true}).click();await expect(page.getByText('Zobrazuji 11–20 z 58 faktur')).toBeVisible();
    await control.selectOption('50');await expect(page.getByText('Zobrazuji 1–50 z 58 faktur')).toBeVisible();await expect(page.locator('tbody tr')).toHaveCount(50);assert(requests.some(r=>r.url.includes('page_size=50')&&r.url.includes('page=1')));
    const cookie=(await page.context().cookies()).find(cookie=>cookie.name==='splatno-invoices-page-size');assert.equal(cookie.value,'50');assert(cookie.expires>Date.now()/1000+300*86400);
    await page.reload();await expect(control).toHaveValue('50');
    await page.goto('http://127.0.0.1:4331/invoices');await expect(control).toHaveValue('50');
   }finally{await page.close()}
  });
  for(const scenario of ['viewer','empty','stress'])await check('State '+scenario,async()=>{
   const{page}=await pageFor(scenario);try{
    if(scenario==='viewer'){await expect(page.getByRole('link',{name:'Importovat fakturu',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Akce faktury 1443260143',exact:true}).click();await expect(page.getByRole('button',{name:'Potvrdit úhradu',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');}
    if(scenario==='empty'){await expect(page.getByText('Zatím nemáte žádné faktury.')).toBeVisible();await expect(page.getByRole('link',{name:'Přidat ručně',exact:true})).toBeVisible();}
    if(scenario==='stress'){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const financial=await page.locator('tbody tr').evaluateAll(rows=>rows.every(row=>[row.cells[3].querySelector('strong'),row.cells[6].querySelector('div > span')].every(node=>{const range=document.createRange();range.selectNodeContents(node);return range.getBoundingClientRect().right<=node.closest('td').getBoundingClientRect().right+1})));assert(financial,'Financial values overlap cells');const rows=await page.locator('tbody tr').evaluateAll(rows=>rows.map(row=>{const cells=[...row.cells];return cells.slice(1,-1).every(cell=>[...cell.children].every(node=>node.getBoundingClientRect().right<=cell.getBoundingClientRect().right+1))}));assert(rows.every(Boolean),'Stress values overlap columns');}
    await page.screenshot({path:resolve(output,`state-${scenario}.png`),fullPage:false});
   }finally{await page.close()}
  });
  await check('Filtered summary keeps large monetary values and currency on one line',async()=>{
   for(const width of [320,390,768,1280,1536]){
    const {page}=await pageFor('stress',{width,height:width<768?844:1024});try{
     const summary=page.locator('[data-invoice-summary]');
     const amounts=await summary.locator('strong').evaluateAll(nodes=>nodes.map(node=>{
      const range=document.createRange();range.selectNodeContents(node);const text=range.getBoundingClientRect(),card=node.closest('[data-invoice-summary]').getBoundingClientRect();
      return{text:node.textContent,height:text.height,lineHeight:parseFloat(getComputedStyle(node).lineHeight),fits:text.left>=card.left&&text.right<=card.right};
     }));
     assert(amounts.every(amount=>amount.height<=amount.lineHeight+1&&amount.fits),`Filtered summary overflow at ${width}: ${JSON.stringify(amounts)}`);
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
     await summary.screenshot({path:resolve(output,`summary-large-${width}.png`)});
    }finally{await page.close()}
   }
  });
  await check('Summary only shows amounts, follows all filters across pages and supports retry',async()=>{
   const{page,requests,failTotals}=await pageFor('paging');try{
    const summary=page.locator('[data-invoice-summary]');
    const format=value=>new Intl.NumberFormat('cs-CZ',{style:'currency',currency:'CZK',minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
    await expect(summary.locator('strong')).toHaveAttribute('aria-label',format(invoiceTotals(undefined,'paging',invoicePagingRows).CZK));
    await expect(summary.locator('svg:visible')).toHaveCount(1);
    await expect(summary.locator('button,small')).toHaveCount(0);
    const count=requests.filter(request=>request.url.startsWith('/api/invoices/totals')).length;
    await page.getByRole('button',{name:'Další stránka',exact:true}).click();await expect(page.getByText('Zobrazuji 26–50 z 58 faktur')).toBeVisible();
    assert.equal(requests.filter(request=>request.url.startsWith('/api/invoices/totals')).length,count);
    await page.getByRole('combobox',{name:'Stav',exact:true}).selectOption('paid');
    const paid=invoiceTotals(new URL('http://fixture/api/invoices?status=paid'),'paging',invoicePagingRows).CZK;
    await expect(summary.locator('strong')).toHaveAttribute('aria-label',format(paid));assert(paid>0);
    failTotals();await page.getByRole('combobox',{name:'Stav',exact:true}).selectOption('overdue');
    await expect(summary.getByRole('button',{name:'Zkusit znovu'})).toBeVisible();await summary.getByRole('button',{name:'Zkusit znovu'}).click();
    await expect(summary.locator('strong')).toHaveAttribute('aria-label',format(invoiceTotals(new URL('http://fixture/api/invoices?status=overdue'),'paging',invoicePagingRows).CZK));
   }finally{await page.close()}
  });
  await check('Mobile filter disclosure, row menu and unobscured pagination',async()=>{
   const{page}=await pageFor('normal',{width:390,height:844});try{
    await page.getByRole('button',{name:'Filtry faktur',exact:true}).click();await expect(page.getByRole('combobox',{name:'Stav',exact:true})).toBeVisible();await page.getByRole('button',{name:'Zavřít filtry',exact:true}).click();await page.getByRole('button',{name:'Akce faktury 1443260143',exact:true}).click();const menu=page.getByRole('dialog',{name:'Akce faktury 1443260143',exact:true});await expect(menu).toBeVisible();const bounds=await menu.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=390);await page.keyboard.press('Escape');await page.locator('[data-invoice-pagination]').scrollIntoViewIfNeeded();await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));const pageButton=page.getByRole('button',{name:'Stránka 1',exact:true});await pageButton.click();await expect(page.locator('[data-esko-launcher],[data-esko-restore]')).toHaveCount(0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   }finally{await page.close()}
  });
 }
 await writeFile(resolve(output,before?'before-validation.json':'validation.json'),JSON.stringify({type:'Real React components with synthetic HTTP data; not authenticated Next E2E',results,functional},null,2));
 console.log(JSON.stringify({output,checked:results.length,functional: functional.length,failures:results.filter(result=>result.errors.length)},null,2));if(results.some(result=>result.errors.length))process.exitCode=1;
}finally{await browser.close();await server.close()}
