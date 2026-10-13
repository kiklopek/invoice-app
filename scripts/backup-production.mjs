// Ruční záloha produkce: databáze (pg_dump) + všechny soubory ze Supabase
// Storage + manifest s počty řádků a kontrolními součty souborů.
//
// Proč existuje: projekt běží na tarifu Supabase Free, který žádné zálohy
// nedělá. A ani placené zálohy Supabase neobsahují soubory ve Storage
// (PDF faktur, bankovní výpisy, loga). Tento skript je jediná záloha, dokud
// nebude Pro tarif + vlastní záloha bucketů (docs/operations.md).
//
//   SUPABASE_DB_URL="postgresql://postgres.<ref>:<heslo>@<host>:5432/postgres" \
//   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=… \
//   node scripts/backup-production.mjs [--out backups] [--skip-db] [--skip-storage]
//
// Vyžaduje pg_dump ve verzi >= verze serveru (produkce: PostgreSQL 17).
// Skript nic nemaže ani nemění: databázi jen čte, Storage jen stahuje.
// Výstup obsahuje osobní a finanční údaje zákazníků: ukládejte ho šifrovaně
// mimo Supabase a nikdy ho necommitujte (složka backups/ je v .gitignore).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(option("--out", "backups"), stamp);
const manifest = { createdAt: new Date().toISOString(), database: null, storage: null, tableCounts: {} };
const problems = [];

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Chybí proměnná ${name}.`);
    process.exit(1);
  }
  return value;
}

// Chybějící proměnná zastaví skript dřív, než vznikne prázdná složka zálohy.
if (!flag("--skip-db")) requireEnv("SUPABASE_DB_URL");
if (!flag("--skip-storage")) {
  requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

await mkdir(outDir, { recursive: true });
console.log(`Záloha do ${outDir}`);

// 1) Databáze. Schémata s daty aplikace a přihlášení; extensions a interní
//    schémata Supabase se obnoví z platformy.
if (!flag("--skip-db")) {
  const dbUrl = requireEnv("SUPABASE_DB_URL");
  const dumpFile = join(outDir, "database.dump");
  const result = spawnSync(
    "pg_dump",
    [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--schema=public",
      "--schema=private",
      "--schema=auth",
      "--schema=storage",
      `--file=${dumpFile}`,
      dbUrl,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (result.error || result.status !== 0) {
    problems.push(`pg_dump selhal (${result.error?.message ?? `exit ${result.status}`}). Je nainstalovaný pg_dump verze 17+?`);
  } else {
    manifest.database = { file: "database.dump", format: "pg_dump custom", schemas: ["public", "private", "auth", "storage"] };
    console.log("Databáze: hotovo");
  }
}

// 2) Storage + počty řádků přes service klienta (jen čtení).
if (!flag("--skip-storage")) {
  const supabase = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const table of ["organizations", "organization_members", "customers", "invoices", "invoice_uploads", "bank_payments", "bank_statement_imports", "bank_statement_entries", "reminder_log", "subscriptions"]) {
    const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
    if (error) problems.push(`Počet řádků ${table}: ${error.message}`);
    else manifest.tableCounts[table] = count;
  }

  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) {
    problems.push(`Seznam bucketů: ${bucketError.message}`);
  } else {
    manifest.storage = { buckets: {} };
    for (const bucket of buckets) {
      const files = [];
      const queue = [""];
      while (queue.length) {
        const prefix = queue.shift();
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await supabase.storage.from(bucket.name).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
          if (error) {
            problems.push(`Výpis ${bucket.name}/${prefix}: ${error.message}`);
            break;
          }
          for (const item of data) {
            const path = prefix ? `${prefix}/${item.name}` : item.name;
            // Složky vrací Storage API bez id.
            if (item.id === null) queue.push(path);
            else files.push(path);
          }
          if (data.length < 1000) break;
        }
      }

      const entries = [];
      for (const path of files) {
        const { data, error } = await supabase.storage.from(bucket.name).download(path);
        if (error) {
          problems.push(`Stažení ${bucket.name}/${path}: ${error.message}`);
          continue;
        }
        const bytes = Buffer.from(await data.arrayBuffer());
        const target = join(outDir, "storage", bucket.name, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes);
        entries.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      }
      manifest.storage.buckets[bucket.name] = { files: entries.length, listed: files.length, entries };
      console.log(`Storage ${bucket.name}: ${entries.length}/${files.length} souborů`);
    }
  }
}

manifest.problems = problems;
await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Počty řádků: ${JSON.stringify(manifest.tableCounts)}`);

if (problems.length) {
  console.error(`\nZáloha NENÍ úplná (${problems.length} problémů):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("\nZáloha je úplná. Zašifrujte složku a uložte ji mimo Supabase.");
