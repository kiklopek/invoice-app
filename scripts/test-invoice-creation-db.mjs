// Disposable PostgreSQL emulator; no production connection or financial mutations.
import { readFile } from 'node:fs/promises';
import { replayMigrations } from './payment-assistance-db-fixture.mjs';
import { PGlite } from '../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/index.js';
import { pg_trgm } from '../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js';
const db=new PGlite({extensions:{pg_trgm}});
try{
 await replayMigrations(sql=>db.exec(sql),true);
 await db.exec(await readFile('supabase/tests/invoice_creation.sql','utf8'));
 await db.exec(await readFile('supabase/tests/dashboard_snapshot.sql','utf8'));
 console.log('PASS invoice creation: migration replay, mixed VAT, snapshot immutability, no-email reminders, unique numbering, tenant customer guards and existing dashboard');
}catch(error){console.error(error.message,error.detail??'',error.where??'');process.exitCode=1;}finally{await db.close();}
