// Disposable local PostgreSQL harness; never connects to production.
// Runner setup: npm install --prefix .cache/reconciliation-tools --no-save --package-lock=false @electric-sql/pglite@0.3.14
import { readFile } from "node:fs/promises";
import { replayMigrations } from "./payment-assistance-db-fixture.mjs";
import { PGlite } from "../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { pg_trgm } from "../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js";

const db = new PGlite({ extensions: { pg_trgm } });
try {
  await replayMigrations((sql) => db.exec(sql), true);
  for (const name of ["multi_tenant_guards.sql", "billing_exempt.sql"]) {
    await db.exec((await readFile(`supabase/tests/${name}`, "utf8")).replace(/^\\.*$/gm, ""));
    console.log(`Passed ${name}`);
  }
} catch (error) {
  console.error(error.message, error.detail ?? "", error.where ?? "");
  process.exitCode = 1;
} finally {
  await db.close();
}
