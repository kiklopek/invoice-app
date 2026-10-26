import { readFile } from 'node:fs/promises';
import { replayMigrations } from './payment-assistance-db-fixture.mjs';
import { PGlite } from '../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/index.js';
import { pg_trgm } from '../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js';
const db=new PGlite({extensions:{pg_trgm}});
try{await replayMigrations(sql=>db.exec(sql),true);for(const name of ['financial_report','invoice_creation','dashboard_snapshot']){await db.exec(await readFile(`supabase/tests/${name}.sql`,'utf8'));console.log('PASS '+name);}}catch(error){console.error(error.message,error.detail??'',error.where??'');process.exitCode=1;}finally{await db.close();}
