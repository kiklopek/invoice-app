import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { numericInvoiceNumber } from "./invoice-number";
import { normalizeVariableSymbol } from "./payment-import";

/**
 * Pravidla párování existují v TS (náhled výpisu) i v SQL (zaúčtování). Stejné
 * vstupy musí obě implementace normalizovat stejně, jinak by náhled slíbil něco
 * jiného, než databáze zaúčtuje. Běží nad lokální PGlite s přehranými
 * migracemi; bez ní (CI) se přeskočí. Nikdy se nepřipojuje k produkci.
 */
const pgliteDir = resolve(process.cwd(), ".cache/reconciliation-tools/node_modules/@electric-sql/pglite/dist");
const available = existsSync(`${pgliteDir}/index.js`);

const symbols = ["2600194", "0002600194", " 2600194 ", "VS 2600194", "26-001-94", "000", "", "12345678901", "0"];
const numbers = ["2026001", "2026/001", "2026-001", "2026.001", "2026 001", "FV-2026/001", "FV2026", "001/2026", "", "  45  "];

describe.skipIf(!available)("TS a SQL normalizují stejně", () => {
  let db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, string>> }>; close: () => Promise<void> };
  beforeAll(async () => {
    const { PGlite } = await import(/* @vite-ignore */ `${pgliteDir}/index.js`);
    const { pg_trgm } = await import(/* @vite-ignore */ `${pgliteDir}/contrib/pg_trgm.js`);
    const { replayMigrations } = await import(/* @vite-ignore */ resolve(process.cwd(), "scripts/payment-assistance-db-fixture.mjs"));
    db = new PGlite({ extensions: { pg_trgm } });
    await replayMigrations((sql: string) => (db as unknown as { exec: (s: string) => Promise<unknown> }).exec(sql), true);
  }, 240_000);
  afterAll(async () => { await db?.close(); });

  it.each(symbols)("variabilní symbol %j", async (value) => {
    const { rows } = await db.query("select coalesce(private.normalize_vs($1), '') as v", [value]);
    // Jediná vědomá výjimka: samé nuly TS uloží jako „0“ (zobrazení), SQL je
    // bere jako žádný VS. Pro párování to nevadí, „0“ nikdy nic nenajde.
    const expected = /^\s*0+\s*$/.test(value) ? "" : normalizeVariableSymbol(value);
    expect(rows[0].v).toBe(expected);
  });

  it.each(numbers)("číslo faktury %j", async (value) => {
    const { rows } = await db.query("select coalesce(private.numeric_invoice_number($1), '') as v", [value]);
    expect(rows[0].v).toBe(numericInvoiceNumber(value) ?? "");
  });
});
