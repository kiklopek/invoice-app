import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {matchingFixture} from './payment-matching-fixtures.mjs';
const project=process.cwd(),fixture=resolve('.cache/payment-matching'),output=resolve('docs/redesign/visual-validation/payment-matching');
await mkdir(fixture,{recursive:true});await mkdir(output,{recursive:true});
await writeFile(resolve(fixture,'index.html'),'<html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>');
await writeFile(resolve(fixture,'link.tsx'),"import{createElement}from'react';export default function Link({children,prefetch:_p,...props}){return createElement('a',props,children)}");
await writeFile(resolve(fixture,'image.tsx'),"import{createElement}from'react';export default function Image({priority:_p,preload:_pr,fill:_f,unoptimized:_u,...props}){return createElement('img',props)}");
await writeFile(resolve(fixture,'navigation.tsx'),"export function usePathname(){return location.pathname}export function useRouter(){return{push:url=>location.assign(url),replace:url=>location.replace(url),prefetch:()=>{},refresh:()=>{}}}export function useSearchParams(){return new URLSearchParams(location.search)}");
await writeFile(resolve(fixture,'entry.tsx'),`import React from 'react';import{createRoot}from'react-dom/client';import '${project}/src/app/globals.css';import '${project}/src/app/minimal.css';import '${project}/src/app/styles/responsive.css';import '${project}/src/app/styles/invoice-cards.css';import{AppShell}from'${project}/src/components/layout/app-shell';import{WorkspaceDataProvider}from'${project}/src/components/workspace-data-provider';import{ToastProvider}from'${project}/src/components/toast';import{PaymentsClient}from'${project}/src/app/(workspace)/invoices/payments/payments-client';const invoices=${JSON.stringify(matchingFixture().invoices)};createRoot(document.getElementById('root')).render(<WorkspaceDataProvider><ToastProvider><AppShell initialProfile={{role:'admin',name:'Tomáš R.',email:'test@example.invalid',companyName:'Demo firma s.r.o.'}}><PaymentsClient initialData={{payments:[],open_invoices:invoices,can_manage:true,gpc_enabled:true,runtime_mode:'production-database'}}/></AppShell></ToastProvider></WorkspaceDataProvider>);`);
const require=createRequire(import.meta.url),vr=createRequire(require.resolve('vitest/config'));
const {createServer}=await import(pathToFileURL(vr.resolve('vite')).href);
const server=await createServer({configFile:false,root:fixture,publicDir:resolve('public'),logLevel:'error',server:{host:'127.0.0.1',port:4347,strictPort:true,fs:{allow:[project]}},esbuild:{jsx:'automatic'},css:{postcss:{plugins:[]}},resolve:{alias:[{find:'next/link',replacement:resolve(fixture,'link.tsx')},{find:'next/image',replacement:resolve(fixture,'image.tsx')},{find:'next/navigation',replacement:resolve(fixture,'navigation.tsx')},{find:'@',replacement:resolve('src')}],dedupe:['react','react-dom']}});
await server.listen();const browser=await chromium.launch();const results=[];
async function pageFor(width=1536,height=1024,scenario='normal'){
 const page=await browser.newPage({viewport:{width,height}}),data=matchingFixture(scenario),requests=[],errors=[];let failSave=false;
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',async route=>{
  const r=route.request(),url=new URL(r.url()),path=url.pathname;requests.push({path,method:r.method(),body:r.method()==='PATCH'?r.postDataJSON():null});
  if(path==='/api/payments/imports'&&r.method()==='POST')return route.fulfill({json:data.preview});
  if(path==='/api/payments/imports')return route.fulfill({json:{imports:[]}});
  if(path==='/api/payments/invoice-candidates'){
   const q=(url.searchParams.get('q')||'').toLowerCase();const invoices=data.invoices.filter(i=>[i.invoice_number,i.variable_symbol,i.counterparty_name,i.counterparty_ico].join(' ').toLowerCase().includes(q));return route.fulfill({json:{invoices,total:invoices.length}});
  }
  if(path===`/api/payments/imports/${data.preview.import.id}`){
   if(r.method()==='PATCH'){
    if(failSave){failSave=false;return route.fulfill({status:409,json:{error:'Návrh mezitím změnil jiný uživatel.'}});}
    data.detail.import.revision++;return route.fulfill({json:{revision:data.detail.import.revision}});
   }
   return route.fulfill({json:data.detail});
  }
  if(path.endsWith('/commit'))return route.fulfill({json:{status:'review',revision:4,imported:1,matched:1,remaining:1,errors:[]}});
  return route.fulfill({json:path==='/api/search'?{results:[]}:{payments:[],invoices:[],total:0,imports:[],overdue:0,upcoming:0,recent:[]}});
 });
 await page.goto(`http://127.0.0.1:4347/invoices/payments?scenario=${scenario}`);
 if(!process.argv.includes('--upload-only')){await page.locator('input[type=file]').setInputFiles({name:'výpis_GPC_2025-10-07.gpc',mimeType:'text/plain',buffer:Buffer.from('synthetic fixture')});
 await expect(page.locator('[data-payment-matching]')).toBeVisible();if(scenario!=='bank')await expect(page.locator('[data-payment-row="payment-1"]').getByRole('button',{name:'Potvrdit',exact:true})).toBeEnabled();
 }
 await page.evaluate(()=>document.fonts.ready);
 return{page,data,requests,errors,fail:()=>{failSave=true}};
}
async function check(name,run){await run();results.push({name,passed:true});console.log('PASS '+name);}
try{
 if(process.argv.includes('--upload-only')){
  if(!process.argv.includes('--esko-only'))for(const [width,height] of [[320,568],[360,740],[375,812],[390,844],[430,932],[480,844],[600,900],[767,1024],[768,1024],[820,1024],[1024,768],[1280,800],[1440,900],[1920,1080]])await check('upload layout '+width,async()=>{
   const c=await pageFor(width,height);try{
    await expect(c.page.locator('input[type=file]')).toHaveCount(1);
    expect(await c.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    expect(c.requests.filter(r=>r.method==='POST')).toHaveLength(0);
    if(!process.argv.includes('--before-upload')){
     await expect(c.page.locator('.gpc-panel')).toHaveJSProperty('scrollTop',0);
     expect(await c.page.locator('.gpc-panel').evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
     if(width<768){
      await expect(c.page.getByRole('heading',{name:'Nahrát bankovní výpis',level:1,exact:true})).toBeVisible();
      await expect(c.page.getByRole('link',{name:'Zpět na platby',exact:true})).toHaveAttribute('href','/invoices/payments/archive');
      await expect(c.page.locator('.payments-hero-side')).toBeHidden();
      const info=c.page.locator('.gpc-mobile-info');
      await expect(info).not.toHaveAttribute('open');
      await info.locator('summary').focus();await c.page.keyboard.press('Enter');
      await expect(info).toHaveAttribute('open','');
      await expect(info.getByText('Potvrdíte zaúčtování',{exact:true})).toBeVisible();
      await c.page.keyboard.press('Enter');await expect(info).not.toHaveAttribute('open');
     }else await expect(c.page.locator('.gpc-safety-card')).toBeVisible();
     await c.page.locator('input[type=file]').focus();
     expect(await c.page.locator('.gpc-dropzone').evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
     await c.page.locator('input[type=file]').blur();
    }
    if(!process.argv.includes('--before-upload') && width<768){
     expect(await c.page.evaluate(()=>document.documentElement.scrollHeight)).toBeLessThanOrEqual(height+1);
     expect(await c.page.locator('main').evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom))).toBe(15);
    }
    await c.page.evaluate(()=>window.scrollTo({top:0,left:0,behavior:"instant"}));
    if(!process.argv.includes('--before-upload')){
     const help=c.page.locator('button[aria-controls="esko-panel"]');
     if(await help.count()){
      const overlaps=await c.page.evaluate(()=>{
       const help=document.querySelector('button[aria-controls="esko-panel"]')?.getBoundingClientRect();
       if(!help)return false;
       return ['.gpc-select-file','.gpc-mobile-info summary','.gpc-safety-card'].some(selector=>{
        const el=document.querySelector(selector);if(!el||!el.getClientRects().length)return false;
        const r=el.getBoundingClientRect();return r.left<help.right&&r.right>help.left&&r.top<help.bottom&&r.bottom>help.top;
       });
      });
      expect(overlaps).toBe(false);
     }
    }
    await c.page.screenshot({path:resolve(output,`${process.argv.includes('--before-upload')?'before-upload':'upload'}-${width}.png`),fullPage:true});
    expect(c.errors).toEqual([]);
   }finally{await c.page.close()}
  });
  if(!process.argv.includes('--before-upload')&&!process.argv.includes('--esko-only'))for(const [width,height] of [[320,568],[390,844],[820,1024],[1440,900]])await check('upload error, long filename and retry '+width,async()=>{
   const c=await pageFor(width,height);try{
    let uploads=0;
    await c.page.route('**/api/payments/imports',async route=>{
     if(route.request().method()!=='POST')return route.fallback();
     uploads++;
     if(uploads===1)return route.fulfill({status:400,json:{error:'Soubor nevypadá jako výpis ve formátu GPC ani CSV.'}});
     return route.fallback();
    });
    const file={name:'NespravnyVelmiDlouhyNazevVypisu'.repeat(6)+'.gpc',mimeType:'text/plain',buffer:Buffer.from('malformed statement fixture')};
    await c.page.locator('input[type=file]').setInputFiles(file);
    await expect(c.page.getByRole('alert')).toContainText('Soubor nevypadá');
    await expect(c.page.locator('input[type=file]')).toHaveAttribute('aria-invalid','true');
    await expect(c.page.locator('.payments-hero')).toBeVisible();
    expect(await c.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await c.page.screenshot({path:resolve(output,`upload-error-${width}.png`),fullPage:true});
    await c.page.locator('input[type=file]').setInputFiles(file);
    await expect(c.page.locator('[data-payment-matching]')).toBeVisible();
    expect(uploads).toBe(2);
    expect(c.requests.filter(r=>r.path.endsWith('/commit'))).toHaveLength(0);
    expect(c.errors).toEqual([]);
   }finally{await c.page.close()}
  });
  if(process.argv.includes('--esko-only'))for(const width of [320,390,600,767,768,1440])await check('Esko navigation and native dialog '+width,async()=>{
   const c=await pageFor(width,844);try{
    await expect(c.page.locator('[data-esko-launcher],[data-esko-restore]')).toHaveCount(0);
    if(width<1024)await c.page.getByRole('button',{name:'Otevřít navigaci',exact:true}).click();
    await c.page.getByRole('button',{name:'Esko',exact:true}).filter({visible:true}).click();
    const panel=c.page.getByRole('dialog',{name:'Esko',exact:true});await expect(panel).toBeVisible();
    const box=await panel.boundingBox();expect(box.x).toBeGreaterThanOrEqual(8);expect(box.x+box.width).toBeLessThanOrEqual(width-8);
    await panel.getByRole('textbox').fill('Rozepsaná otázka');await c.page.keyboard.press('Escape');await expect(panel).toHaveCount(0);
    if(width<1024)await expect(c.page.getByRole('button',{name:'Otevřít navigaci',exact:true})).toBeFocused();
    expect(c.errors).toEqual([]);
   }finally{await c.page.close()}
  });
 }else{

 for(const [width,height]of[[1536,1024],[1440,900],[1024,768],[768,1024],[390,844],[320,568]])await check(`layout ${width}x${height}`,async()=>{
  const c=await pageFor(width,height);try{
   expect(await c.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   const rows=await c.page.locator('[data-payment-row]').evaluateAll(nodes=>nodes.map(node=>({height:node.getBoundingClientRect().height,actions:[...node.querySelectorAll('button')].filter(b=>b.textContent==='Potvrdit'||b.getAttribute('aria-label')?.startsWith('Akce platby')).map(b=>({top:b.getBoundingClientRect().top,bottom:b.getBoundingClientRect().bottom}))})));
   for(const row of rows){expect(Math.abs(row.actions[0].top-row.actions[1].top)).toBeLessThan(3);if(width>=1440)expect(row.height).toBeLessThanOrEqual(115);}
   await c.page.screenshot({path:resolve(output,`after-${width}x${height}.png`),fullPage:width<768});
   expect(c.errors).toEqual([]);
  }finally{await c.page.close()}
 });
 await check('picker follows the row while scrolling and notices expire after five seconds',async()=>{
  const c=await pageFor(1536,900,'duplicate');try{
   const notice=c.page.getByRole('status').filter({hasText:'Tento výpis už byl dříve nahraný.'});
   await expect(notice).toBeVisible();
   const trigger=c.page.getByRole('button',{name:'Vybrat fakturu · řádek 1',exact:true});
   await trigger.click();
   const dialog=c.page.getByRole('region',{name:'Vybrat fakturu · řádek 1',exact:true});
   const fits=async()=>dialog.evaluate(panel=>{
    const box=panel.getBoundingClientRect(),field=panel.parentElement.parentElement.getBoundingClientRect();
    return box.top>=11&&box.bottom<=innerHeight-11&&box.left>=11&&box.right<=innerWidth-11
      &&(Math.abs(box.top-field.bottom-8)<3||Math.abs(box.bottom-field.top+8)<3);
   });
   const beforeScroll=await c.page.evaluate(()=>window.scrollY);
   await c.page.evaluate(()=>window.scrollBy(0,100));
   expect(await c.page.evaluate(()=>window.scrollY)).toBeGreaterThan(beforeScroll);
   await expect.poll(fits).toBe(true);
   await expect(notice).toHaveCount(0,{timeout:6500});
   await expect.poll(fits).toBe(true);
   await expect(dialog).toBeVisible();
  }finally{await c.page.close()}
 });
 await check('inline searchable dropdown on desktop/mobile',async()=>{
  for(const width of[1536,390,320]){const height=width===320?568:width===390?844:1024;const c=await pageFor(width,height);try{
   await c.page.getByRole('button',{name:'Vybrat fakturu · řádek 4',exact:true}).click();const dialog=c.page.getByRole('region',{name:'Vybrat fakturu · řádek 4',exact:true});
   await expect(dialog).toBeVisible();
   await expect(c.page.locator('dialog[open]')).toHaveCount(0);
   const centered=await dialog.getByRole('button',{name:'Zavřít',exact:true}).evaluate(button=>{
    const a=button.getBoundingClientRect(),b=button.querySelector('svg').getBoundingClientRect();
    return Math.abs(a.x+a.width/2-b.x-b.width/2)<1&&Math.abs(a.y+a.height/2-b.y-b.height/2)<1;
   });expect(centered).toBe(true);
   const box=await dialog.boundingBox();expect(box.x).toBeGreaterThanOrEqual(11);expect(box.x+box.width).toBeLessThanOrEqual(width-11);expect(box.y).toBeGreaterThanOrEqual(11);expect(box.y+box.height).toBeLessThanOrEqual(height-11);expect(box.height).toBeLessThanOrEqual(400);
   await c.page.screenshot({path:resolve(output,`picker-${width}.png`),fullPage:false});
   await dialog.getByRole('textbox',{name:'Hledat fakturu',exact:true}).fill('2600629');
   await expect(dialog.getByRole('group',{name:'Dostupné faktury'}).getByRole('button')).toHaveCount(1);
   await expect(dialog.getByRole('button',{name:/VS 2600629/})).toBeEnabled();
   await c.page.setViewportSize({width,height:height-150});await expect(dialog).toBeVisible();
   await expect.poll(()=>dialog.evaluate(panel=>{
    const box=panel.getBoundingClientRect(),nav=document.querySelector('.mobile-navigation-bar');
    const navigationBottom=nav?.getBoundingClientRect().bottom??0;
    return box.top>=Math.max(0,navigationBottom)+11&&box.bottom<=innerHeight-11;
   })).toBe(true);
   await dialog.getByRole('textbox',{name:'Hledat fakturu',exact:true}).focus();await c.page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
   await dialog.getByRole('button',{name:/VS 2600629/}).click();await expect(dialog).toHaveCount(0);
   const row=c.page.locator('[data-payment-row="payment-4"]');await expect(row.getByRole('button',{name:'Potvrdit',exact:true})).toBeEnabled();await row.getByRole('button',{name:'Potvrdit',exact:true}).click();
   const saves=c.requests.filter(r=>r.method==='PATCH');expect(saves).toHaveLength(1);expect(saves[0].body.reviewed_entry_ids).toEqual([c.data.detail.entries[3].id]);expect(c.requests.filter(r=>r.path.endsWith('/commit'))).toHaveLength(0);
  }finally{await c.page.close()}}
 });
 await check('bulk selection is indeterminate and only saves selected rows',async()=>{
  const c=await pageFor();try{
   await c.page.getByRole('checkbox',{name:'Vybrat platbu, řádek 1',exact:true}).check();expect(await c.page.getByRole('checkbox',{name:'Vybrat vše na aktuální stránce'}).evaluate(el=>el.indeterminate)).toBe(true);
   await c.page.getByRole('button',{name:'Potvrdit vybrané',exact:true}).click();const saves=c.requests.filter(r=>r.method==='PATCH');expect(saves).toHaveLength(1);expect(saves[0].body.reviewed_entry_ids).toEqual([c.data.detail.entries[0].id]);
  }finally{await c.page.close()}
 });
 await check('status tooltip, detail dialog and context menu',async()=>{
  const c=await pageFor();try{
   const row=c.page.locator('[data-payment-row="payment-1"]');await row.getByRole('button',{name:'Vysoká shoda',exact:true}).hover();await expect(row.getByRole('tooltip').filter({hasText:'Jednoznačně navržená shoda'})).toBeVisible();
   const status=row.getByRole('button',{name:'Vysoká shoda',exact:true});await c.page.mouse.move(0,0);await status.focus();await c.page.keyboard.press('Escape');await expect(status).toBeFocused();await expect(row.getByRole('tooltip').filter({hasText:'Jednoznačně navržená shoda'})).toBeHidden();
   await row.getByRole('button',{name:'Detail platby · řádek 1',exact:true}).click();const dialog=c.page.getByRole('dialog',{name:'Detail platby · řádek 1',exact:true});await expect(dialog).toContainText('Odpovídá variabilní symbol a částka.');await c.page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
   await row.getByRole('button',{name:'Akce platby · řádek 1',exact:true}).click();await expect(c.page.getByRole('dialog').getByRole('button',{name:'Rozdělit platbu',exact:true})).toBeVisible();await c.page.keyboard.press('Escape');expect(c.errors).toEqual([]);
  }finally{await c.page.close()}
 });
 await check('bank account gate and save failure retain decisions',async()=>{
  const c=await pageFor(1440,900,'bank');try{
   const row=c.page.locator('[data-payment-row="payment-1"]');await expect(row.getByRole('button',{name:'Potvrdit',exact:true})).toBeDisabled();await expect(c.page.getByRole('button',{name:'Zaúčtovat výpis',exact:true})).toBeDisabled();
   await c.page.getByText('Bankovní účet vyžaduje kontrolu',{exact:false}).first().click();await c.page.getByRole('checkbox',{name:'Potvrdit kontrolu bankovního účtu'}).check();
   c.fail();await row.getByRole('button',{name:'Potvrdit',exact:true}).click();await expect(c.page.getByRole('alert')).toContainText('jiný uživatel');await expect(row).toContainText('ACME s.r.o.');await expect(row.getByRole('button',{name:'Potvrdit',exact:true})).toBeEnabled();
   await c.page.screenshot({path:resolve(output,'account-and-error.png'),fullPage:false});
  }finally{await c.page.close()}
 });
 await check('ignored duplicate booked and error rows remain available',async()=>{
  const c=await pageFor(1536,1024,'special');try{
   for(const key of['ignored','duplicate','booked','error']){const row=c.page.locator(`[data-payment-row="${key}"]`);await expect(row).toBeVisible();await expect(row.getByRole('button',{name:'Potvrdit',exact:true})).toHaveCount(0);}
   await c.page.screenshot({path:resolve(output,'special-states.png'),fullPage:true});
  }finally{await c.page.close()}
 });
 for(const width of [320,390,768,1440])await check('icon filters, active chips and reset '+width,async()=>{
  const c=await pageFor(width,844);try{
   const trigger=c.page.getByRole('button',{name:'Filtry plateb',exact:true});
   await expect(c.page.getByRole('group',{name:'Stav párování'})).toHaveCount(0);
   await trigger.click();const dialog=c.page.getByRole('dialog',{name:'Filtry plateb',exact:true});
   await dialog.getByRole('button',{name:/Nespárováno/}).click();
   await dialog.getByRole('button',{name:'Zobrazit výsledky',exact:true}).click();
   await expect(dialog).toHaveCount(0);
   await expect(c.page.getByRole('button',{name:'Zrušit filtr stavu párování',exact:true})).toBeVisible();
   await c.page.getByRole('button',{name:'Zrušit filtr stavu párování',exact:true}).click();
   await expect(c.page.getByRole('button',{name:'Zrušit filtr stavu párování',exact:true})).toHaveCount(0);
   await trigger.click();await dialog.getByRole('button',{name:/K ověření/}).click();
   await dialog.getByRole('combobox',{name:'Typ položek',exact:true}).selectOption('ignored');
   expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
   await c.page.screenshot({path:resolve(output,`filters-${width}.png`)});
   await dialog.getByRole('button',{name:'Resetovat',exact:true}).click();
   await expect(dialog.getByRole('combobox',{name:'Typ položek',exact:true})).toHaveValue('all');
   await expect(dialog.getByRole('button',{name:/Všechny/})).toHaveAttribute('aria-pressed','true');
   await c.page.keyboard.press('Escape');await expect(trigger).toBeFocused();
   expect(c.requests.filter(r=>r.method==='PATCH'||r.method==='POST'&&r.path.endsWith('/commit'))).toHaveLength(0);
   expect(c.errors).toEqual([]);
  }finally{await c.page.close()}
 });
}
}finally{await browser.close();await server.close();await writeFile(resolve(output,process.argv.includes('--esko-only') ? 'esko-validation.json' : process.argv.includes('--upload-only') ? (process.argv.includes('--before-upload') ? 'before-upload-validation.json' : 'upload-validation.json') : 'validation.json'),JSON.stringify({scope:'Real AppShell/PaymentsClient and native dialogs; synthetic scoped API fixtures, no live auth or payment writes.',results},null,2));}
