import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const directory = join(process.cwd(), "supabase", "migrations");
const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
const versions = new Set();
const errors = [];

for (const name of names) {
  const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(name);
  if (!match) {
    errors.push(`${name}: expected YYYYMMDDHHMMSS_snake_case.sql`);
    continue;
  }
  if (versions.has(match[1])) errors.push(`${name}: duplicate migration version ${match[1]}`);
  versions.add(match[1]);
  const sql = await readFile(join(directory, name), "utf8");
  if (!sql.trim()) errors.push(`${name}: migration is empty`);
  if (/\bdrop\s+(table|schema|database)\b/i.test(sql)) {
    errors.push(`${name}: destructive DROP requires an explicitly reviewed deployment workflow`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Validated ${names.length} Supabase migrations.`);
