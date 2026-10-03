import { readdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,relative } from 'node:path';
async function files(dir){const result=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,e.name);if(e.isDirectory())result.push(...await files(p));else result.push(p);}return result;}
const paths=await files(resolve('src/app'));const routes=[],pages=[];
for(const path of paths){const name=relative(process.cwd(),path).replaceAll('\\','/');
  if(path.endsWith('route.ts')){const source=await readFile(path,'utf8');routes.push({path:name,methods:[...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\b/g)].map(m=>m[1])});}
  if(path.endsWith('page.tsx'))pages.push(name);
}
const sql=[];for(const path of await files(resolve('supabase/migrations'))){if(!path.endsWith('.sql'))continue;const source=await readFile(path,'utf8');for(const m of source.matchAll(/create (?:or replace )?function\s+([\w.]+)\s*\(([^)]*)\)/gi))sql.push({function:m[1],arguments:m[2].replace(/\s+/g,' ').trim(),migration:relative(process.cwd(),path).replaceAll('\\','/')});}
const functions=[...new Map(sql.map(f=>[`${f.function}(${f.arguments})`,f])).values()];
const cron=JSON.parse(await readFile('vercel.json','utf8')).crons;
const inventory={pages,routes,functions,cron,roles:['admin','accounting','viewer'],external_services:['Supabase Auth/Postgres/Storage','Resend','ARES','Gemini (optional OCR)','Vercel hosting/crons'],note:'Inventory is not evidence that each path has passed a live scenario.'};
await writeFile('docs/audits/2026-10-03-release/inventory.json',JSON.stringify(inventory,null,2)+'\n');console.log(`${pages.length} pages, ${routes.length} endpoints, ${functions.length} function declarations, ${cron.length} cron jobs.`);
