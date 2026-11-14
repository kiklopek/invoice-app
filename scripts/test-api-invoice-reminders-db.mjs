// Disposable PGlite database; no network or production database access.
import { readFile } from 'node:fs/promises';
import { replayMigrations } from './payment-assistance-db-fixture.mjs';
import { PGlite } from '../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/index.js';
import { pg_trgm } from '../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js';
const db = new PGlite({ extensions: { pg_trgm } });
try {
  await replayMigrations(sql => db.exec(sql), true);
  await db.exec(await readFile('supabase/tests/api_invoice_reminders.sql', 'utf8'));
  await db.exec(await readFile('supabase/tests/api_payments_page.sql', 'utf8'));
  console.log('PASS API reminders: atomic pause/resume, queue cancellation, in-flight guard, tenant/role isolation and unchanged money/status');
  console.log('PASS API payments: committed split allocations, invoice filter, balances, bounded cursor and tenant isolation');
} catch (error) {
  console.error(error.message, error.detail ?? '', error.where ?? ''); process.exitCode=1;
} finally { await db.close(); }
