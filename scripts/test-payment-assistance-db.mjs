// Disposable PostgreSQL-in-WASM harness. Install the pinned runner separately:
// npm install --prefix .cache/reconciliation-tools --no-save --package-lock=false @electric-sql/pglite@0.3.14
// node scripts/test-payment-assistance-db.mjs
import { replayMigrations,runSqlRegressions } from './payment-assistance-db-fixture.mjs';
import { PGlite } from '../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/index.js';
import { pg_trgm } from '../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js';
const db = new PGlite({ extensions: { pg_trgm } });
try {
  await replayMigrations(sql => db.exec(sql),true);
  await runSqlRegressions(sql => db.exec(sql));
} catch (error) {
  console.error(error.message, error.detail ?? '', error.where ?? '');
  process.exitCode = 1;
} finally { await db.close(); }
