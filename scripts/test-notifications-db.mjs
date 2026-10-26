// Disposable PostgreSQL database. No network and no production credentials.
import { readFile } from "node:fs/promises";
import { replayMigrations } from "./payment-assistance-db-fixture.mjs";
import { PGlite } from "../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { pg_trgm } from "../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js";
const db = new PGlite({ extensions: { pg_trgm } });
try {
  await replayMigrations(sql => db.exec(sql), true);
  await db.exec(await readFile("supabase/tests/notifications.sql", "utf8"));
  console.log("PASS notification events, deduplication, per-user reads, roles, tenant isolation and pagination");
} catch (e) { console.error(e.message, e.detail ?? "", e.where ?? ""); process.exitCode=1; }
finally { await db.close(); }
