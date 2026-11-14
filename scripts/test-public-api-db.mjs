import { readFile } from "node:fs/promises";
import { replayMigrations } from "./payment-assistance-db-fixture.mjs";
import { PGlite } from "../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { pg_trgm } from "../.cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js";

const db = new PGlite({ extensions: { pg_trgm } });
try {
  await replayMigrations(async sql => {
    await db.exec(sql);
    // Model hosted Supabase's default service-role table grants. The API
    // migration must explicitly remove UPDATE/DELETE from append-only logs.
    if (sql.includes("create role anon;")) {
      await db.exec("alter default privileges in schema public grant all on tables to service_role;");
    }
  }, true);
  await db.exec(await readFile("supabase/tests/public_api.sql", "utf8"));
  console.log("PASS API key lifecycle, scopes, rate limits, current membership, organization isolation, request audit and invoice number reservations");
} catch (error) {
  console.error(error.message, error.detail ?? "", error.where ?? "");
  process.exitCode = 1;
} finally {
  await db.close();
}
