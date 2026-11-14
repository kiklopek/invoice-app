// Disposable local SQL harness; never connects to a hosted database.
import { readFile } from "node:fs/promises";
import { replayMigrations } from "./payment-assistance-db-fixture.mjs";
import { PGlite } from "../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { pg_trgm } from "../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js";

const db = new PGlite({ extensions: { pg_trgm } });
try {
  await replayMigrations(sql => db.exec(sql), true);
  await db.exec(await readFile("supabase/tests/public_api_customers.sql", "utf8"));
  console.log("PASS API customer creation, immutable replay after contact edits, conflicts, current role, tenant isolation and orphan preservation");
} catch (error) {
  console.error(error.message, error.detail ?? "");
  process.exitCode = 1;
} finally { await db.close(); }
