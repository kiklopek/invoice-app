// Disposable local PostgreSQL; never connects to a hosted database.
// npm install --prefix .cache/reconciliation-tools --no-save --package-lock=false @electric-sql/pglite@0.3.14
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { replayMigrations } from "./payment-assistance-db-fixture.mjs";

const moduleRoot = resolve(process.env.SEARCH_TEST_TOOLS_DIR ?? ".cache/reconciliation-tools", "node_modules/@electric-sql/pglite/dist");
const { PGlite } = await import(pathToFileURL(`${moduleRoot}/index.js`));
const { pg_trgm } = await import(pathToFileURL(`${moduleRoot}/contrib/pg_trgm.js`));
const db = new PGlite({ extensions: { pg_trgm } });
try {
  await replayMigrations((sql) => db.exec(sql), true);
  await db.exec(await readFile("supabase/tests/comprehensive_search.sql", "utf8"));
  await db.exec("set enable_seqscan = off");
  for (const [table, fields] of [
    ["invoices", "invoice_number, counterparty_name, counterparty_ico, counterparty_dic, counterparty_email, variable_symbol, notes"],
    ["customers", "name, ico, dic, email, phone, address"],
  ]) {
    const plan = await db.query(`explain select id from public.${table} where public.search_document(array[${fields}]) like '%novak%'`);
    if (!JSON.stringify(plan.rows).includes(`${table}_normalized_search_trgm`)) throw new Error(`Search index not usable: ${table}`);
  }
  console.log("Passed search normalization, combined terms, literal input, pagination, totals and tenant permissions.");
} catch (error) {
  console.error(error.message, error.detail ?? "", error.where ?? "");
  process.exitCode = 1;
} finally {
  await db.close();
}
