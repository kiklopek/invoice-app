// Local PostgreSQL 17, loopback only, disposable workspace data. No remote DB.
// npm install --prefix .cache/reconciliation-tools --no-save --package-lock=false @electric-sql/pglite@0.3.14 embedded-postgres@17.10.0-beta.17 pg@8.16.3
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import EmbeddedPostgres from '../.cache/reconciliation-tools/node_modules/embedded-postgres/dist/index.js';
import { replayMigrations,runSqlRegressions } from './payment-assistance-db-fixture.mjs';
const pg = new EmbeddedPostgres({ databaseDir:resolve('.cache',`reconciliation-pg-${randomUUID()}`),port:55432,user:'postgres',password:randomUUID(),persistent:true,
  createPostgresUser:false,initdbFlags:['--encoding=UTF8'],postgresFlags:['-h','127.0.0.1'],onLog:() => {},onError:() => {} });
let a,b,started=false;
async function fixture(client) {
  const org=randomUUID(),actor=randomUUID(),invoice=randomUUID(),p1=randomUUID(),p2=randomUUID();
  await client.query(`insert into auth.users(id,email) values($1,$2)`,[actor,`${actor}@hlavica.cz`]);
  await client.query(`insert into organizations(id,name,ico) values($1,'Concurrent fixture','12345678')`,[org]);
  await client.query("insert into subscriptions(organization_id,status,plan,period,billing_exempt) select id,'active','business','yearly',true from organizations o where not exists(select 1 from subscriptions s where s.organization_id=o.id)");
  await client.query(`insert into organization_members(organization_id,user_id,email,role) values($1,$2,$3,'admin')`,[org,actor,`${actor}@hlavica.cz`]);
  await client.query(`insert into invoices(id,organization_id,invoice_number,counterparty_name,counterparty_ico,counterparty_email,amount_without_vat,vat_rate,amount,currency,issue_date,due_date,created_by)
    values($1,$2,'1001','Customer','12345678','c@example.cz',100,0,100,'CZK',current_date,current_date,$3)`,[invoice,org,actor]);
  for (const [id,amount] of [[p1,40],[p2,60]]) await client.query(`insert into bank_payments(id,organization_id,external_id,booked_on,amount,currency,variable_symbol,imported_by) values($1::uuid,$2,$1::text,current_date,$3,'CZK','1001',$4)`,[id,org,amount,actor]);
  await client.query(`select configure_payment_assistance($1,'review',true,true)`,[org]);
  const input=(await client.query(`select payment_assistance_inputs($1) input`,[org])).rows[0].input;
  const proposal={ kind:'unique',engine_version:'assistance-v1',input_hash:'a'.repeat(64),currency:'CZK',payment_ids:[p1,p2],invoice_ids:[invoice],memory_ids:[],
    snapshot:{ payments:input.payments,invoices:input.invoices,memories:input.memories },reason:'Two instalments',allocations:[{ payment_id:p1,invoice_id:invoice,amount:40 },{ payment_id:p2,invoice_id:invoice,amount:60 }] };
  const job=(await client.query(`select claim_payment_assistance_job($1) job`,[org])).rows[0].job;
  await client.query(`select finish_payment_assistance_job($1,$2,$3,$4,null,1)`,[org,job.lease_token,input.generation,JSON.stringify([proposal])]);
  const id=(await client.query(`select id from payment_assistance_proposals where organization_id=$1 and status='pending'`,[org])).rows[0].id;
  return { org,actor,invoice,id,input,proposal };
}
try {
  await pg.initialise(); await pg.start(); started=true;
  a=pg.getPgClient(); b=pg.getPgClient(); await a.connect(); await b.connect();
  await a.query(`set statement_timeout='10s'`); await b.query(`set statement_timeout='10s'`);
  await replayMigrations(sql => a.query(sql));
  await runSqlRegressions(sql => a.query(sql));
  const f=await fixture(a);
  const replies=await Promise.all([a.query(`select decide_payment_assistance($1,$2,$3,true) result`,[f.org,f.actor,f.id]),b.query(`select decide_payment_assistance($1,$2,$3,true) result`,[f.org,f.actor,f.id])]);
  assert.equal(replies.filter(r => r.rows[0].result.idempotent).length,1);
  assert.equal((await a.query(`select paid_amount::text paid from invoices where id=$1`,[f.invoice])).rows[0].paid,'100.00');
  assert.equal(Number((await a.query(`select count(*) n from bank_payment_allocations where organization_id=$1`,[f.org])).rows[0].n),2);
  console.log('Passed concurrent confirmation: exactly two allocations, one idempotent reply');
  const stale=await fixture(a);
  await a.query('begin');
  await a.query(`update invoices set variable_symbol='9999' where id=$1`,[stale.invoice]);
  const pending=b.query(`select decide_payment_assistance($1,$2,$3,true)`,[stale.org,stale.actor,stale.id]);
  const rejected=assert.rejects(pending,/proposal_changed/);
  await a.query('commit'); await rejected;
  assert.equal((await a.query(`select paid_amount::text paid from invoices where id=$1`,[stale.invoice])).rows[0].paid,'0.00');
  console.log('Passed concurrent invoice edit: stale confirmation refused, balance unchanged');
  const race=await fixture(a);
  await a.query(`update payment_assistance_jobs set completed_generation=0 where organization_id=$1`,[race.org]);
  const lease=(await a.query(`select claim_payment_assistance_job($1) job`,[race.org])).rows[0].job;
  await a.query('begin');
  await a.query(`select decide_payment_assistance($1,$2,$3,true)`,[race.org,race.actor,race.id]);
  const finishing=b.query(`select finish_payment_assistance_job($1,$2,$3,$4,null,1)`,[race.org,lease.lease_token,race.input.generation,JSON.stringify([race.proposal])]);
  await a.query('commit'); await finishing;
  assert.equal((await a.query(`select lease_token from payment_assistance_jobs where organization_id=$1`,[race.org])).rows[0].lease_token,null);
  console.log('Passed worker/confirmation race: no deadlock, changed generation requeued');
} catch(error) { console.error(error.message,error.detail ?? '',error.where ?? ''); process.exitCode=1; }
finally { if(a) await a.end(); if(b) await b.end(); if(started) await pg.stop(); }
