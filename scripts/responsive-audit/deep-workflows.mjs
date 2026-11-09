// Reuses reviewed synthetic browser checks against the exact production source.
// Only generated harness copies/cache/artifacts are written, never application files.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
const source = "/tmp/splatno-responsive-production-26defdc",
  dir = resolve(".cache/responsive-audit/deep"),
  out = resolve("artifacts/responsive-audit/2026-11-02/deep-workflows");
await mkdir(dir, { recursive: true });
await mkdir(out, { recursive: true });
const clean = (text) =>
  text
    .replaceAll("WOOD & PAPER a.s.", "Ukázková firma s.r.o.")
    .replaceAll("Dominik Heiniš", "Ukázkový plátce")
    .replaceAll("C.S.CARGO a.s.", "Ukázkový dopravce")
    .replaceAll("PST CLC Mitsui-Soko a.s.", "Ukázková logistika")
    .replaceAll("Marland s.r.o.", "Ukázkový dodavatel");
const processing = process.argv.includes("--processing-only");
const runs = processing
    ? [
        {
          name: "ocr-processing",
          script: "ocr-review-design-check.mjs",
          args: ["--processing"],
        },
      ]
    : [
        { name: "ocr-review", script: "ocr-review-design-check.mjs" },
        { name: "payment-matching", script: "payment-matching-check.mjs" },
      ],
  results = [];
for (const run of runs) {
  const output = resolve(out, run.name);
  await mkdir(output, { recursive: true });
  let text = clean(
    await readFile(resolve(source, "scripts", run.script), "utf8"),
  );
  if (run.name === "ocr-review" || run.name === "ocr-processing")
    text = text
      .replace(
        "const root = process.cwd();",
        `const root = ${JSON.stringify(source)};`,
      )
      .replace(
        "resolve(root, 'docs/redesign/visual-validation/ocr-review')",
        JSON.stringify(output),
      );
  else {
    text = text
      .replace(
        "const project=process.cwd()",
        `const project=${JSON.stringify(source)}`,
      )
      .replace(
        "resolve('docs/redesign/visual-validation/payment-matching')",
        JSON.stringify(output),
      )
      .replace(
        "replacement:resolve('src')",
        "replacement:resolve(project,'src')",
      )
      .replace(
        "publicDir:resolve('public')",
        "publicDir:resolve(project,'public')",
      );
    await writeFile(
      resolve(dir, "payment-matching-fixtures.mjs"),
      clean(
        await readFile(
          resolve(source, "scripts/payment-matching-fixtures.mjs"),
          "utf8",
        ),
      ),
    );
  }
  if (processing) {
    let helper = await readFile(
      resolve(source, "scripts/ocr-processing-checks.mjs"),
      "utf8",
    );
    helper = helper.replace(
      "resolve(root, 'docs/redesign/visual-validation/ocr-processing')",
      JSON.stringify(output),
    );
    await writeFile(resolve(dir, "ocr-processing-checks.mjs"), helper);
  }
  const generated = resolve(dir, run.script);
  await writeFile(generated, text);
  const log = [];
  const code = await new Promise((res, rej) => {
    const child = spawn(process.execPath, [generated, ...(run.args || [])], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => {
      log.push(d.toString());
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      log.push(d.toString());
      process.stderr.write(d);
    });
    child.on("error", rej);
    child.on("close", res);
  });
  await writeFile(resolve(output, "execution.log"), log.join(""));
  results.push({
    name: run.name,
    sourceCommit: "26defdcc90f9ebaf979d40d23a6c5c7648dd0e0f",
    exitCode: code,
    output,
    scope:
      "real production-source UI; synthetic API/document responses; no production writes",
  });
  await writeFile(
    resolve(out, processing ? "processing-results.json" : "results.json"),
    JSON.stringify(results, null, 2),
  );
}
