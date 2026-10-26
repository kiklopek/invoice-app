import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(vitestRequire.resolve("vite")).href);
import { chromium } from "@playwright/test";

const project = process.cwd();
const fixture = resolve(project, ".cache/onboarding-account-switch");
const output = resolve(project, "artifacts/onboarding-account-switch");
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });
await writeFile(resolve(fixture, "index.html"), '<html lang="cs"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/entry.tsx"></script></html>');
await writeFile(resolve(fixture, "link.tsx"), "import {createElement} from 'react';export default function Link({children,...props}){return createElement('a',props,children)}");
await writeFile(resolve(fixture, "image.tsx"), "import {createElement} from 'react';export default function Image({fill,priority,unoptimized,...props}){return createElement('img',props)}");
await writeFile(resolve(fixture, "font.ts"), "export function Inter(){return {className:''}}");
await writeFile(resolve(fixture, "entry.tsx"), `
import React from 'react';import {createRoot} from 'react-dom/client';
import '${project}/src/app/globals.css';
import {OnboardingClient} from '${project}/src/app/(onboarding)/onboarding/onboarding-client';
import {normalizeOnboardingDraft} from '${project}/src/lib/onboarding-draft';
const step=Number(new URLSearchParams(location.search).get('step')||1);
const draft=normalizeOnboardingDraft({version:1,step,reached:Math.min(7,step),updatedAt:1,company:{name:'Ukázková firma',email:'example@example.invalid'},reminders:{days:[-3,0,7,14],replyTo:'',ccText:''},invites:[]});
createRoot(document.getElementById('root')).render(location.pathname==='/login'?<h1>Přihlášení</h1>:<OnboardingClient accountId="account-fixture" accountEmail="example@example.invalid" accountName="Ukázkový účet" initialDraft={draft} payment={step===8?{companyName:'Ukázková firma',canManage:true,plan:'profi',period:'monthly'}:null}/>);
`);
const server = await createServer({ configFile:false, root:fixture, publicDir:resolve(project,"public"), logLevel:"error", server:{host:"127.0.0.1",port:4341,strictPort:true,fs:{allow:[project]}},esbuild:{jsx:"automatic"},css:{postcss:{plugins:[]}},resolve:{alias:[{find:/^next\/link$/,replacement:resolve(fixture,"link.tsx")},{find:/^next\/image$/,replacement:resolve(fixture,"image.tsx")},{find:/^next\/font\/google$/,replacement:resolve(fixture,"font.ts")},{find:"@",replacement:resolve(project,"src")}],dedupe:["react","react-dom"]}});
await server.listen();
const browser=await chromium.launch();
const results=[];
try {
  for(const [width,height] of [[1536,1024],[1440,900],[820,1180],[390,844]]){
    for(let step=1;step<=8;step++){
      const page=await browser.newPage({viewport:{width,height}});
      const requests=[];const errors=[];
      page.on("pageerror",e=>errors.push(e.message));
      await page.route("**/api/**",async route=>{
        requests.push({path:new URL(route.request().url()).pathname,method:route.request().method()});
        await route.fulfill({status:200,json:{saved:true,signed_out:true}});
      });
      await page.goto(`http://127.0.0.1:4341/onboarding?step=${step}`);
      const button=page.getByRole("button",{name:"Zpátky na přihlášení",exact:true});
      await button.waitFor({state:"visible"});
      const rect=await button.boundingBox();
      if(!rect||rect.x<0||rect.y<0||rect.x+rect.width>width||rect.y+rect.height>height)errors.push("Account switch outside viewport");
      const horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      if(horizontalOverflow)errors.push("Horizontal overflow");
      if(step===1||step===8)await page.screenshot({path:resolve(output,`step-${step}-${width}x${height}.png`)});
      await button.click();
      await page.waitForURL("**/login");
      if(requests.filter(r=>r.path==='/api/auth/logout'&&r.method==='POST').length!==1)errors.push("Expected exactly one local logout POST");
      const logout=requests.findIndex(r=>r.path==='/api/auth/logout');
      if(requests.slice(logout+1).some(r=>r.path==='/api/onboarding/draft'))errors.push("Draft sent after logout started");
      results.push({width,height,step,errors});
      await page.close();
    }
  }
}finally{await browser.close();await server.close();}
await writeFile(resolve(output,"results.json"),JSON.stringify({type:"Real onboarding UI with synthetic logout/draft responses; no live auth or data changes",results},null,2));
const failures=results.filter(r=>r.errors.length);
console.log(JSON.stringify({checked:results.length,failures},null,2));
if(failures.length)process.exitCode=1;
