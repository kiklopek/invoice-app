// Synthetic loopback database only. Never accepts a remote connection URL.
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import EmbeddedPostgres from '../.cache/reconciliation-tools/node_modules/embedded-postgres/dist/index.js';
import { replayMigrations } from './payment-assistance-db-fixture.mjs';
const output=resolve('docs/audits/2026-10-03-release');await mkdir(output,{recursive:true});
const count=Number(process.env.AUDIT_INVOICES ?? 300000);
if(!Number.isInteger(count) || count<100 || count>300000)throw new Error('Synthetic count must be 100..300000.');
const pg=new EmbeddedPostgres({databaseDir:resolve('.cache',`release-scale-${randomUUID()}`),port:55434,user:'postgres',password:randomUUID(),persistent:true,createPostgresUser:false,initdbFlags:['--encoding=UTF8'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
let client,started=false;const clients=[];const evidence={scope:'local PostgreSQL, synthetic data; not HTTPS/Auth/API/staging load',count,steps:[],security:[]};
const org=randomUUID(),other=randomUUID(),actor=randomUUID();
async function step(name,query,params=[]){const start=performance.now();const result=await client.query(query,params);evidence.steps.push({name,ms:Math.round(performance.now()-start)});console.log(`${name}: ${evidence.steps.at(-1).ms}ms`);return result;}
try {
  await pg.initialise();await pg.start();started=true;client=pg.getPgClient();await client.connect();await replayMigrations(sql=>client.query(sql));
  await client.query("create or replace function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create or replace function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$");
  await client.query('insert into auth.users(id,email) values($1,$2)',[actor,'release-audit@hlavica.cz']);
  await client.query("insert into organizations(id,name,ico) values($1,'Synthetic scale','12345678'),($2,'Other organization','87654321')",[org,other]);
  await client.query("insert into subscriptions(organization_id,status,plan,period,billing_exempt) select id,'active','business','yearly',true from organizations o where not exists(select 1 from subscriptions s where s.organization_id=o.id)");
  await client.query("insert into organization_members(organization_id,user_id,email,role) values($1,$2,'release-audit@hlavica.cz','accounting')",[org,actor]);
  await step('seed invoices',`create table audit_fixture as select g,gen_random_uuid() invoice,gen_random_uuid() payment from generate_series(1,$1::integer) g;
  `,[count]);
  await step('insert invoices',`insert into invoices(id,organization_id,invoice_number,counterparty_name,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by)
    select invoice,$1,'AUDIT-'||g,'Customer '||(g%1000),'customer@example.invalid',100,0,100,'CZK',date '2023-01-01'+((g-1)%1095),date '2023-01-15'+((g-1)%1095),$2 from audit_fixture`,[org,actor]);
  await step('insert payments',`insert into bank_payments(id,organization_id,external_id,booked_on,amount,currency,source,imported_by)
    select payment,$1,'AUDIT-'||g,date '2023-01-06'+((g-1)%1095),100,'CZK','manual',$2 from audit_fixture`,[org,actor]);
  await step('insert 2 allocations/payment',`insert into bank_payment_allocations(organization_id,bank_payment_id,invoice_id,amount,is_committed,created_by,committed_at)
    select $1::uuid,a.payment,b.invoice,50,true,$2::uuid,now() from audit_fixture a join audit_fixture b on b.g=a.g
    union all select $1::uuid,a.payment,b.invoice,50,true,$2::uuid,now() from audit_fixture a join audit_fixture b on b.g=case when a.g=$3::integer then 1 else a.g+1 end`,[org,actor,count]);
  await step('verify independent ledger totals',`select count(*)::integer n,sum(amount)::text total from bank_payment_allocations where organization_id=$1`,[org]).then(r=>{assert.equal(r.rows[0].n,count*2);assert.equal(Number(r.rows[0].total),count*100);});
  await client.query('analyze invoices;analyze bank_payments;analyze bank_payment_allocations;analyze organization_members');
  const samples=[];
  for(let i=0;i<50;i++){const c=pg.getPgClient();await c.connect();clients.push(c);}
  await Promise.all(clients.map(async c=>{const start=performance.now();await c.query('select id,invoice_number,amount from invoices where organization_id=$1 order by issue_date desc,id limit 50',[org]);samples.push(performance.now()-start);}));
  samples.sort((a,b)=>a-b);evidence.read_load={connections:50,p95_ms:Math.round(samples[Math.ceil(samples.length*.95)-1]),note:'SQL sessions, not authenticated browser/API sessions'};
  await Promise.all(clients.slice(0,20).map((c,i)=>c.query("update invoices set counterparty_name=counterparty_name where organization_id=$1 and invoice_number=$2",[org,`AUDIT-${i+1}`])));
  evidence.concurrent_writes={connections:20,result:'completed',note:'independent synthetic invoices, not HTTP requests'};
  const plan=await client.query('explain (analyze,buffers,format json) select id,invoice_number from invoices where organization_id=$1 order by issue_date desc,id limit 50',[org]);evidence.list_query_plan=plan.rows[0]['QUERY PLAN'];
  await client.query('grant select on public.invoices to authenticated;set role authenticated');
  await client.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[actor,JSON.stringify({sub:actor,email:'release-audit@hlavica.cz',role:'authenticated'})]);
  const rls=(await client.query('select count(*)::integer n from invoices where organization_id=$1',[other])).rows[0].n;
  assert.equal(rls,0);evidence.security.push({name:'cross organization invoice read',status:'PASS',visible:rls});
  const preMfa=(await client.query('select id from invoices where organization_id=$1 limit 1',[org])).rowCount;
  evidence.security.push({name:'direct table read before app email MFA',status:preMfa?'FAIL':'PASS',visible:preMfa,note:'SQL reproduction with auth JWT context; real PostgREST token test still requires isolated Supabase staging'});
  await client.query('reset role');
  await client.query("select configure_payment_assistance($1,'shadow',false,true)",[org]);
  try {await client.query('select payment_assistance_inputs($1)',[org]);evidence.assistance={status:'PASS'};}
  catch(error){evidence.assistance={status:'BLOCKED',reason:error.message};}
  evidence.financial_note='Fixture intentionally starts with unpaid invoice cache; allocation total tested independently. No claim that cached paid_amount already equals ledger.';
}catch(error){evidence.error=error.message;process.exitCode=1;console.error(error.message);}
finally{await writeFile(resolve(output,'database-scale.json'),JSON.stringify(evidence,null,2)+'\n');await Promise.allSettled(clients.map(c=>c.end()));if(client)await client.end();if(started)await pg.stop();}
