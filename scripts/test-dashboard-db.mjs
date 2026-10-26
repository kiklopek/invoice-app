// Disposable PostgreSQL database: all migrations and synthetic fixtures, no credentials.
import { readFile } from "node:fs/promises";
import { replayMigrations } from "./payment-assistance-db-fixture.mjs";
import { PGlite } from "../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { pg_trgm } from "../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js";
const db = new PGlite({ extensions: { pg_trgm } });
try {
  await replayMigrations(sql => db.exec(sql), true);
  await db.exec(await readFile("supabase/tests/dashboard_snapshot.sql", "utf8"));
  console.log("PASS dashboard snapshot: >1000 invoices, periods, currency/status charts, partial receipts, cancelled invoices, preview caps, action counts and tenant permissions");
} catch (e) { console.error(e.message, e.detail ?? "", e.where ?? ""); process.exitCode=1; }
finally { await db.close(); }
