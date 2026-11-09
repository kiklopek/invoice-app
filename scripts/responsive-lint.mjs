// Ratchet against ad-hoc breakpoints (TRANSITION_RULES pravidlo 10).
// Counts width/height conditions in `@media` queries under src/ whose value is
// not one of the agreed breakpoints, per file. The counts may only go down:
//   node scripts/responsive-lint.mjs            # check against the baseline, exit 1 if any file grew
//   node scripts/responsive-lint.mjs --update   # write the current counts as the new baseline
// Component layout belongs in `@container` queries, which are not counted.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BASELINE = join(ROOT, "scripts/responsive-lint-baseline.json");
// Shell and family breakpoints from TRANSITION_RULES (± 1 px for max-* pairs).
const WIDTHS = [360, 390, 480, 520, 640, 767, 768, 1023, 1024, 1099, 1100, 1179, 1180, 1199, 1200, 1279, 1280, 1399, 1400, 1439, 1440, 1599, 1600, 1919, 1920, 2199, 2200, 2559, 2560];
const HEIGHTS = [600, 660, 740, 760, 800, 830, 899, 900, 1000, 1240];

async function cssFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await cssFiles(path)));
    else if (entry.name.endsWith(".css")) out.push(path);
  }
  return out;
}

const counts = {};
for (const file of await cssFiles(join(ROOT, "src"))) {
  const text = await readFile(file, "utf8");
  let stray = 0;
  for (const [, query] of text.matchAll(/@media([^{]+)\{/g)) {
    for (const [, axis, value] of query.matchAll(/\((?:min|max)-(width|height)\s*:\s*([\d.]+)px\)/g)) {
      const allowed = axis === "width" ? WIDTHS : HEIGHTS;
      if (!allowed.includes(Math.round(Number(value)))) stray++;
    }
  }
  if (stray) counts[relative(ROOT, file)] = stray;
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (process.argv.includes("--update")) {
  await writeFile(BASELINE, JSON.stringify({ total, files: counts }, null, 2) + "\n");
  console.log(`Baseline written: ${total} stray breakpoint conditions in ${Object.keys(counts).length} files.`);
  process.exit(0);
}

const baseline = JSON.parse(await readFile(BASELINE, "utf8"));
const grown = Object.entries(counts).filter(([file, n]) => n > (baseline.files[file] ?? 0));
if (grown.length) {
  console.error("New ad-hoc @media breakpoints (use the agreed values or an @container query):");
  for (const [file, n] of grown) console.error(`  ${file}: ${baseline.files[file] ?? 0} → ${n}`);
  process.exit(1);
}
console.log(`OK: ${total} stray breakpoint conditions (baseline ${baseline.total}); none added.`);
if (total < baseline.total) console.log("Fewer than the baseline — run with --update to lock in the improvement.");
