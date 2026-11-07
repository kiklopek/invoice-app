import { readFile, mkdir, writeFile, symlink, access } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
const metadata = JSON.parse(
  await readFile(
    resolve("artifacts/responsive-audit/2026-11-02/production.json"),
    "utf8",
  ),
);
const commit = metadata.commit;
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Invalid pinned commit");
const source = "/tmp/splatno-responsive-production-" + commit.slice(0, 7);
await mkdir(source, { recursive: true });
let existing;
try {
  existing = (await readFile(source + "/.audit-source-commit", "utf8")).trim();
} catch {}
if (existing && existing !== commit)
  throw new Error("Snapshot revision mismatch; refusing to overwrite");
if (!existing) {
  const archive = execFileSync(
    "git",
    [
      "archive",
      commit,
      "src",
      "public",
      "scripts",
      "package.json",
      "pnpm-lock.yaml",
      "tsconfig.json",
      "next.config.js",
      "postcss.config.js",
      "tailwind.config.js",
    ],
    { maxBuffer: 128 * 1024 * 1024 },
  );
  await new Promise((res, rej) => {
    const child = spawn("tar", ["-xf", "-", "-C", source], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.on("error", rej);
    child.on("close", (code) =>
      code ? rej(new Error("Archive extraction failed: " + code)) : res(),
    );
    child.stdin.end(archive);
  });
  await writeFile(source + "/.audit-source-commit", commit + "\n");
}
try {
  await access(source + "/node_modules");
} catch {
  await symlink(resolve("node_modules"), source + "/node_modules", "dir");
}
console.log(
  JSON.stringify({
    source,
    commit,
    scope:
      "isolated archive of tracked production revision, no working-tree modifications",
  }),
);
