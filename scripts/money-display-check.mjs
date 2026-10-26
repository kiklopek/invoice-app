import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { chromium, webkit, expect } from "@playwright/test";
const project = process.cwd(), fixture = resolve(".cache/money-display"), output = resolve("docs/redesign/visual-validation/money-display");
await mkdir(fixture,{recursive:true}); await mkdir(output,{recursive:true});
await writeFile(resolve(fixture,"index.html"),'<html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>');
await writeFile(resolve(fixture,"entry.tsx"),`
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import'${project}/src/app/globals.css';import'${project}/src/app/minimal.css';
import{SummaryMoney,ExactMoney}from'${project}/src/components/money-amount';
import report from'${project}/src/app/(workspace)/reports/reports.module.css';
import invoice from'${project}/src/app/(workspace)/invoices/invoices.module.css';
import dashboard from'${project}/src/app/(workspace)/dashboard/dashboard-summary.module.css';
import matching from'${project}/src/app/(workspace)/invoices/payments/payment-matching.module.css';
const samples=[0,.01,999999.99,1817153.1,-2365000.55,999999500,2000000000000.99];
function Demo(){const[index,setIndex]=useState(3);const value=samples[index];return <main style={{padding:16,maxWidth:1200,margin:'auto'}}><h1>Částky: souhrn a přesná hodnota</h1><label>Testovací částka<select aria-label="Testovací částka" value={index} onChange={e=>setIndex(Number(e.target.value))}>{samples.map((v,i)=><option value={i} key={i}>{v}</option>)}</select></label><section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:16,marginTop:20}}>{[180,220,300].map(width=><article data-probe className={report.metric} key={width} style={{width,maxWidth:'100%',boxSizing:'border-box'}}><span>Souhrn pohledávek</span><SummaryMoney value={value}/><small>Podle vybraného období</small></article>)}<article data-probe className={invoice.summary}><div className={invoice.summaryAmounts}><SummaryMoney value={value} currency="EUR"/></div></article><article data-probe className={dashboard.currencyTotals} style={{minWidth:0}}><div><SummaryMoney value={value}/><SummaryMoney value={-value} currency="USD"/></div></article></section><div data-fit-test style={{width:600,maxWidth:"100%",fontSize:20,marginTop:20}}><ExactMoney value={106192.02}/></div><h2>Přesné kontrolní částky</h2><section data-exact-section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:16}}><div className={matching.payment}><strong><ExactMoney value={value}/></strong></div><div className={invoice.amountCell}><strong><ExactMoney value={value} currency="EUR"/></strong></div><div style={{minWidth:0}}><ExactMoney value={value}/></div></section></main>};createRoot(document.getElementById('root')).render(<Demo/>);
`);
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
    port: 4354,
    strictPort: true,
    fs: { allow: [project] },
  },
  esbuild: { jsx: "automatic" },
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: [{ find: "@", replacement: resolve("src") }],
    dedupe: ["react", "react-dom"],
  },
});
await server.listen();
const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const browser = await (engine === "webkit" ? webkit : chromium).launch();
const results=[];
try {
 for(const width of [320,390,768,1536]){
  const page=await browser.newPage({viewport:{width,height:1000}});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://127.0.0.1:4354");
  for(const index of [0,1,2,3,4,5,6]){
   await page.getByLabel("Testovací částka").selectOption(String(index));
   const invalid=await page.locator("[data-money-value] [data-money-visible]").evaluateAll(nodes=>nodes.filter(el=>{
    const range=document.createRange();range.selectNodeContents(el);
    const text=range.getBoundingClientRect(),box=el.getBoundingClientRect();
    return text.width>box.width+1||text.height>parseFloat(getComputedStyle(el).lineHeight)+1;
   }).map(el=>({text:el.textContent,width:el.getBoundingClientRect().width,scroll:el.scrollWidth,font:getComputedStyle(el).fontSize,probe:[...el.parentElement.querySelectorAll("[aria-hidden] > span")].map(p=>({text:p.textContent,w:p.getBoundingClientRect().width,font:getComputedStyle(p).font,letter:getComputedStyle(p).letterSpacing})),fontDetails:getComputedStyle(el).font,letter:getComputedStyle(el).letterSpacing,parent:el.parentElement.outerHTML})));
   expect(invalid).toEqual([]);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   if(index>=3 && await page.locator("[data-probe] [data-money-main]").first().getAttribute("tabindex") === "0"){
    const anchor=page.locator("[data-probe] [data-money-main]").first();
    const exact=await anchor.getAttribute("aria-label");
    await page.mouse.move(0,0);
    await page.getByLabel("Testovací částka").focus();
    await anchor.hover();
    const tooltip=page.getByRole("tooltip");
    await expect(tooltip).toHaveText(exact);
    const box=await tooltip.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");await expect(tooltip).toHaveCount(0);
    await anchor.focus();await expect(tooltip).toHaveText(exact);
    await page.keyboard.press("Escape");await expect(tooltip).toHaveCount(0);
    await anchor.click();await expect(tooltip).toHaveText(exact);
    await page.keyboard.press("Escape");await expect(tooltip).toHaveCount(0);
   }
  }
  const fit=page.locator('[data-fit-test]');
  await fit.evaluate(n=>n.style.width='260px');
  await expect(fit.locator('[data-money-visible]')).toHaveText('106 192,02 Kč');
  await fit.evaluate(n=>n.style.width='110px');
  await expect(fit.locator('[data-money-visible]')).toHaveText(/tis\./);
  await fit.locator('[data-money-value]').click();await expect(page.getByRole('tooltip')).toHaveText('106 192,02 Kč');
  await page.keyboard.press('Escape');await fit.evaluate(n=>n.style.width='260px');
  await expect(fit.locator('[data-money-visible]')).toHaveText('106 192,02 Kč');
  await page.screenshot({path:resolve(output,`money-${engine}-${width}.png`),fullPage:true});
  expect(errors).toEqual([]);results.push({width,passed:true});console.log(`PASS exact/compact amounts, hover, tap, keyboard, no overflow ${width}px`);
  await page.close();
 }
 await writeFile(resolve(output,"validation-${engine}.json"),JSON.stringify(results,null,2));
} finally {await browser.close();await server.close();}
