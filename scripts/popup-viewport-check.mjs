// Actual popup fitter, dashboard chart and OCR picker; no backend or financial writes.
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, webkit, expect } from '@playwright/test';
const project = process.cwd(), fixture = resolve('.cache/popup-viewport');
const output = resolve('docs/redesign/visual-validation/popup-viewport');
await mkdir(fixture, { recursive: true }); await mkdir(output, { recursive: true });
await writeFile(resolve(fixture, 'index.html'), '<html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>');
await writeFile(resolve(fixture, 'link.tsx'), `import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`);
await writeFile(resolve(fixture, 'entry.tsx'), `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import '${project}/src/app/globals.css';import '${project}/src/app/minimal.css';
import {PopupFitter} from '${project}/src/components/popup-fitter';
import {PaymentTrendChart} from '${project}/src/app/(workspace)/dashboard/dashboard-widgets';
import {OcrDocumentPicker} from '${project}/src/app/(workspace)/invoices/import/ocr-document-picker';
import styles from '${project}/src/app/(workspace)/dashboard/dashboard-summary.module.css';
function Demo(){const[active,setActive]=useState(0),[long,setLong]=useState(false);return <>
<PopupFitter/><main className={styles.page} style={{margin:0,padding:16,minHeight:1800}}>
<PaymentTrendChart loading={false} failed={false} currency="CZK" currencies={['CZK','EUR']} onCurrencyChange={()=>{}} retry={()=>{}}/>
<OcrDocumentPicker documents={Array.from({length:30},(_,i)=>({name:'Dlouhy-nazev-dokumentu-'+i+'.pdf',status:'ready'}))} activeIndex={active} onSelect={setActive}/>
<div data-scroll style={{height:240,overflow:'auto',marginTop:30,border:'1px solid #ddd'}}><div style={{height:80}}/>
<details data-stress style={{position:'relative',width:30,marginLeft:0}}><summary>Menu</summary>
<div data-popup style={{position:'absolute',right:0,top:'100%',width:600,padding:16,background:'white',border:'1px solid #ccc'}}>
<button onClick={()=>setLong(!long)}>Změnit délku</button>
{Array.from({length:long?60:3},(_,i)=><button key={i} style={{display:'block',width:'100%',padding:12}}>Položka {i}</button>)}
</div></details><div style={{height:900}}/></div></main></>}
createRoot(document.getElementById('root')).render(<Demo/>);
`);
const require = createRequire(import.meta.url), vitestRequire = createRequire(require.resolve('vitest/config'));
const {createServer} = await import(pathToFileURL(vitestRequire.resolve('vite')).href);
const server=await createServer({configFile:false,root:fixture,publicDir:resolve('public'),logLevel:'error',server:{host:'127.0.0.1',port:4368,strictPort:true,fs:{allow:[project]}},esbuild:{jsx:'automatic'},css:{postcss:{plugins:[]}},resolve:{alias:[{find:'next/link',replacement:resolve(fixture,'link.tsx')},{find:'@',replacement:resolve('src')}],dedupe:['react','react-dom']}});
await server.listen();const results=[];
async function inside(popup,page){await expect(popup).toBeVisible();await expect.poll(()=>popup.evaluate(el=>{const r=el.getBoundingClientRect(),v=visualViewport;return r.left>=(v?.offsetLeft??0)+11&&r.right<=(v?.offsetLeft??0)+(v?.width??innerWidth)-11&&r.top>=(v?.offsetTop??0)+11&&r.bottom<=(v?.offsetTop??0)+(v?.height??innerHeight)-11})).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
try{
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch();
 try{for(const width of [320,360,390,430,600,767,768,1440]){
  const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4368');
  await page.getByLabel('Nastavení grafu').click();
  const chart=page.locator('details:has(summary[aria-label="Nastavení grafu"]) > [data-popup]');await inside(chart,page);
  await expect(chart.getByLabel('Měna grafu')).toBeVisible();
  if(width===390)await page.screenshot({path:resolve(output,engine+'-chart-390.png')});
  await page.getByLabel('Nastavení grafu').click();
  await page.getByLabel('Vybrat fakturu',{exact:true}).click();const picker=page.getByRole('group',{name:'Výběr faktury'});await inside(picker,page);
  await picker.evaluate(el=>el.scrollTop=el.scrollHeight);await picker.getByRole('button').last().click();await expect(picker).not.toBeVisible();
  const stress=page.locator('[data-stress]');await stress.locator('summary').click();const popup=stress.locator('[data-popup]');await inside(popup,page);
  await popup.getByRole('button',{name:'Změnit délku'}).click();await inside(popup,page);
  expect(await popup.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  await popup.evaluate(el=>el.scrollTop=el.scrollHeight);await expect(popup.getByRole('button',{name:'Položka 59',exact:true})).toBeInViewport();
  await page.locator('[data-scroll]').evaluate(el=>el.scrollTop=50);await inside(popup,page);
  await page.setViewportSize({width:Math.min(width,390),height:340});await inside(popup,page);
  await page.evaluate(()=>window.scrollBy(0,120));await inside(popup,page);
  expect(errors).toEqual([]);results.push({engine,width,passed:true});await page.close();
 }}finally{await browser.close()}
}
await writeFile(resolve(output,'results.json'),JSON.stringify(results,null,2));console.log('Passed '+results.length+' popup viewport checks in Chromium and WebKit.');
}finally{await server.close()}
