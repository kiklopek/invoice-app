// Isolated loopback-only preview of the real review component + real test DB.
// Uses synthetic data, no Supabase credentials, no application authentication.
import { mkdir,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import EmbeddedPostgres from '../.cache/reconciliation-tools/node_modules/embedded-postgres/dist/index.js';
import { replayMigrations } from './payment-assistance-db-fixture.mjs';
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vitest/package.json'));
const { createServer } = await import(pathToFileURL(viteRequire.resolve('vite')).href);
const root=resolve('.cache/payment-assistance-preview');
await mkdir(root,{ recursive:true });
await writeFile(resolve(root,'index.html'),'<html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
await writeFile(resolve(root,'link.tsx'),'import { createElement } from "react"; export default function Link({href,children,...props}){return createElement("a",{href,...props},children);}');
await writeFile(resolve(root,'main.tsx'),`
import React from 'react'; import { createRoot } from 'react-dom/client';
import { PaymentAssistancePanel } from '/src/app/(workspace)/invoices/payments/archive/payment-assistance-panel.tsx';
const flags={mode:'review',memory:true,reevaluation:true,camt:false};
const style=document.createElement('style');style.textContent='body{font:16px system-ui;margin:24px;background:#f6f7f5;color:#192720}.page-panel{background:white;border-radius:16px;max-width:1000px;margin:auto}button,input,select{font:inherit;padding:10px;border:1px solid #bcc7bc;border-radius:8px}button{cursor:pointer;background:#ecf3ed}a{color:#1b6634}dialog{max-width:540px;border:0;border-radius:16px;padding:24px}dialog::backdrop{background:#0005}.confirm-dialog-actions{display:flex;gap:12px;justify-content:flex-end}.form-error{color:#a00000}';document.head.append(style);
createRoot(document.getElementById('root')!).render(<PaymentAssistancePanel flags={flags} payments={[]} onConfirmed={async()=>{document.title='Úhrada potvrzena';}}/>);
`);
const pg=new EmbeddedPostgres({ databaseDir:resolve('.cache',`preview-pg-${randomUUID()}`),port:55433,user:'postgres',password:randomUUID(),persistent:true,createPostgresUser:false,
  initdbFlags:['--encoding=UTF8'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{} });
let client,server,started=false;
const org=randomUUID(),actor=randomUUID(),invoice=randomUUID();
async function evaluate() {
  await client.query('select request_payment_assistance($1,$2)',[org,actor]);
  const inputs=(await client.query('select payment_assistance_inputs($1) input',[org])).rows[0].input;
  const engine=await server.ssrLoadModule('/src/lib/payment-assistance.ts');
  const proposals=engine.buildAssistanceProposals(inputs.payments,[...inputs.invoices,...inputs.closed_invoices],inputs.memories);
  const job=(await client.query('select claim_payment_assistance_job($1) job',[org])).rows[0].job;
  await client.query('select finish_payment_assistance_job($1,$2,$3,$4,null,1)',[org,job.lease_token,inputs.generation,JSON.stringify(proposals)]);
}
try {
  await pg.initialise();await pg.start();started=true;client=pg.getPgClient();await client.connect();
  await replayMigrations(sql=>client.query(sql));
  await client.query('insert into auth.users(id,email) values($1,$2)',[actor,'preview@hlavica.cz']);
  await client.query("insert into organizations(id,name,ico) values($1,'Preview','12345678')",[org]);
  await client.query("insert into subscriptions(organization_id,status,plan,period,billing_exempt) select id,'active','business','yearly',true from organizations o where not exists(select 1 from subscriptions s where s.organization_id=o.id)");
  await client.query("insert into organization_members(organization_id,user_id,email,role) values($1,$2,'preview@hlavica.cz','admin')",[org,actor]);
  await client.query("insert into invoices(id,organization_id,invoice_number,counterparty_name,counterparty_ico,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by) values($1,$2,'1001','Testovací zákazník','12345678','test@example.cz',100,0,100,'CZK',current_date,current_date,$3)",[invoice,org,actor]);
  for (const amount of [40,60]) await client.query("insert into bank_payments(organization_id,external_id,booked_on,amount,currency,variable_symbol,counterparty_name,counterparty_account,imported_by) values($1,$2,current_date,$3,'CZK','1001','Testovací plátce','19-2000145399/0800',$4)",[org,randomUUID(),amount,actor]);
  await client.query("select configure_payment_assistance($1,'review',true,true)",[org]);
  server=await createServer({ root,configFile:false,envDir:root,server:{host:'127.0.0.1',port:4188,strictPort:true,fs:{allow:[process.cwd()]}},
    resolve:{alias:{ '@':resolve('src'),'next/link':resolve(root,'link.tsx'),'/src':resolve('src') }},esbuild:{jsx:'automatic'},
    plugins:[{name:'assistance-test-api',configureServer(vite){vite.middlewares.use('/api/payments/assistance',async(req,res)=>{
      res.setHeader('content-type','application/json');
      try {
        if(req.method==='GET') { const data=(await client.query('select payment_assistance_overview($1,$2) data',[org,actor])).rows[0].data;res.end(JSON.stringify({ flags:{mode:'review',memory:true,reevaluation:true,camt:false},...data }));return; }
        let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
        if(body.action==='reevaluate')await evaluate();
        else if(body.action==='decide')await client.query('select decide_payment_assistance($1,$2,$3,$4)',[org,actor,body.proposal_id,body.accept]);
        else if(body.action==='waiting')await client.query('select set_payment_assistance_waiting($1,$2,$3,$4)',[org,actor,body.payment_id,body.waiting]);
        else if(body.action==='memory')await client.query('select save_payment_payer_memory($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[org,actor,body.id,body.revision,body.counterparty_ico,body.account,body.payer_name,body.reference,body.source_payment_ids,body.active]);
        else throw new Error('Unsupported test action');res.end(JSON.stringify({ok:true}));
      } catch(error){res.statusCode=409;res.end(JSON.stringify({error:error.message}));}
    });}}] });
  await evaluate();await server.listen();console.log('Isolated payment assistance preview: http://127.0.0.1:4188');
  const stop=async()=>{await server.close();await client.end();await pg.stop();process.exit(0);};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
} catch(error){console.error(error.message);if(server)await server.close();if(client)await client.end();if(started)await pg.stop();process.exitCode=1;}
